const express = require('express');
const router = express.Router();
const Order = require('../models/Order');
const User = require('../models/User');
const Customer = require('../models/Customer');
const Route = require('../models/Route');
const Product = require('../models/Product');
const { verifyToken, isAdmin, isStaffOrAdmin, canCreateOrders, canModifyOrders } = require('../middleware/auth');
const { emitOrderCreated, emitOrderUpdated, emitOrderDeleted, emitProductUpdated } = require('../socket/events');

// Stock management helper functions
const validateStockAvailability = async (orderItems) => {
  const stockErrors = [];
  
  for (const item of orderItems) {
    if (!item.productId || !item.qty) continue;
    
    const product = await Product.findById(item.productId);
    if (!product) {
      stockErrors.push(`Product not found: ${item.name || item.productId}`);
      continue;
    }
    
    if (product.stockQuantity < item.qty) {
      stockErrors.push(`Insufficient stock for ${product.name}: Available ${product.stockQuantity}, Required ${item.qty}`);
    }
  }
  
  return stockErrors;
};

const updateProductStock = async (orderItems, operation = 'decrease') => {
  const updatedProducts = [];
  
  for (const item of orderItems) {
    if (!item.productId || !item.qty) continue;
    
    const product = await Product.findById(item.productId);
    if (!product) continue;
    
    const quantityChange = operation === 'decrease' ? -item.qty : item.qty;
    const newStockQuantity = Math.max(0, product.stockQuantity + quantityChange);
    
    product.stockQuantity = newStockQuantity;
    await product.save();
    
    updatedProducts.push(product);
    
    // Emit product update event for real-time updates
    emitProductUpdated(product, {
      id: 'system',
      name: 'System',
      role: 'System'
    });
  }
  
  return updatedProducts;
};

const checkLowStockAlerts = async (products) => {
  const lowStockProducts = products.filter(product => 
    product.stockQuantity <= product.lowStockThreshold
  );
  
  return lowStockProducts;
};

// Get orders based on role
router.get('/', verifyToken, async (req, res) => {
  try {
    const user = await User.findById(req.user.id);
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    let orders;
    const now = new Date();
    const timeFilter = {
      $or: [
        { scheduledFor: { $exists: false } },
        { scheduledFor: null },
        { scheduledFor: { $lte: now } }
      ]
    };
    // Admin and Staff can see all orders
    if (['Admin', 'Staff'].includes(user.role)) {
      orders = await Order.find(timeFilter);
    }
    // Executive can only see their own orders
    else if (user.role === 'Executive') {
      orders = await Order.find({ createdBy: user.name, ...timeFilter });
    }
    else {
      return res.status(403).json({ message: 'Unauthorized access' });
    }

    res.json(orders);
  } catch (err) {
    console.error('Error fetching orders:', err);
    res.status(500).json({ message: err.message });
  }
});

// Get order by orderId with role check
router.get('/by-order-id/:orderId', verifyToken, async (req, res) => {
  try {
    const user = await User.findById(req.user.id);
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    const order = await Order.findOne({ orderId: req.params.orderId });
    if (!order) {
      return res.status(404).json({ message: 'Order not found' });
    }

    // Check if Executive is trying to access someone else's order
    if (user.role === 'Executive' && order.createdBy !== user.name) {
      return res.status(403).json({ message: 'Access denied. You can only view orders created by you.' });
    }

    res.json(order);
  } catch (err) {
    console.error('Error fetching order:', err);
    res.status(500).json({ message: err.message });
  }
});

// Get all orders assigned to a specific user by assignedToId
router.get('/assigned/:userId', verifyToken, async (req, res) => {
  try {
    const orders = await Order.find({ assignedToId: req.params.userId });
    res.json(orders);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Add this route to fetch customer names for autocomplete
router.get('/customers', verifyToken, async (req, res) => {
  try {
    const customers = await Customer.find({}, 'name').sort({ name: 1 });
    res.json(customers.map(c => c.name));
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Add this route to fetch order routes for autocomplete
router.get('/routes', verifyToken, async (req, res) => {
  try {
    const routes = await Route.find({}, 'name').sort({ name: 1 });
    res.json(routes.map(r => r.name));
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Helper function to generate order ID
const generateOrderId = async () => {
  try {
    // Find the last order, sorted by orderId in descending order
    const lastOrder = await Order.findOne({}, {}, { sort: { orderId: -1 } });

    let counter = 1;
    if (lastOrder && lastOrder.orderId) {
      // Extract the number from the last orderId (e.g., "ORD-001" -> 1)
      const lastNumber = parseInt(lastOrder.orderId.split('-')[1]);
      if (!isNaN(lastNumber)) {
        counter = lastNumber + 1;
      }
    }

    // Format the new orderId with padded zeros (e.g., "ORD-001")
    return `ORD-${String(counter).padStart(3, '0')}`;
  } catch (err) {
    console.error('Error generating orderId:', err);
    throw new Error('Failed to generate order ID');
  }
};

// Create new order with role check
router.post('/', verifyToken, canCreateOrders, async (req, res) => {
  try {
    const user = await User.findById(req.user.id);
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    const { assignedTo, assignedToId, scheduledFor } = req.body;
    if (!assignedTo || !assignedToId) {
      return res.status(400).json({ message: 'Assigned To and Assigned To ID are required.' });
    }

    // Validate stock availability before creating order
    if (Array.isArray(req.body.orderItems) && req.body.orderItems.length > 0) {
      const stockErrors = await validateStockAvailability(req.body.orderItems);
      if (stockErrors.length > 0) {
        return res.status(400).json({ 
          message: 'Insufficient stock for some products',
          stockErrors 
        });
      }
    }

    const orderId = await generateOrderId();

    let status = 'active';
    let date = new Date();
    let scheduledDate = null;
    if (scheduledFor) {
      scheduledDate = new Date(scheduledFor);
      if (!isNaN(scheduledDate.getTime()) && scheduledDate > new Date()) {
        status = 'scheduled';
        date = scheduledDate;
      }
    }

    // Check if order should be marked as isWithout (assigned to Gaurav Miniyar)
    const isWithout = assignedToId === '685a4143374df5c794581187';

    // Enrich order items with brandName from products
    let enrichedItems = Array.isArray(req.body.orderItems) ? [...req.body.orderItems] : [];
    if (enrichedItems.length > 0) {
      const productIds = enrichedItems.map((it) => it.productId).filter(Boolean);
      const products = await Product.find({ _id: { $in: productIds } }, 'brandName');
      const idToBrand = new Map(products.map((p) => [String(p._id), p.brandName]));
      enrichedItems = enrichedItems.map((it) => ({
        ...it,
        brandName: it.brandName || idToBrand.get(String(it.productId)) || null,
      }));
    }

    const order = new Order({
      ...req.body, // additionalNotes will be included if present
      orderItems: enrichedItems,
      assignedTo,
      assignedToId,
      orderId,
      date,
      scheduledFor: scheduledDate,
      status,
      createdBy: user.name, // Ensure createdBy is set to the current user's name
      isWithout // Set the isWithout field based on assignment
    });
    const newOrder = await order.save();

    // Update product stock quantities after order creation
    if (enrichedItems.length > 0) {
      const updatedProducts = await updateProductStock(enrichedItems, 'decrease');
      
      // Check for low stock alerts
      const lowStockProducts = await checkLowStockAlerts(updatedProducts);
      if (lowStockProducts.length > 0) {
        console.log('Low stock alert:', lowStockProducts.map(p => `${p.name}: ${p.stockQuantity}/${p.lowStockThreshold}`));
      }
    }
    
    // Emit WebSocket event for order creation
    emitOrderCreated(newOrder, {
      id: req.user.id,
      name: req.user.name,
      role: req.user.role
    });
    
    // After order is created, upsert customer name
    if (newOrder.customerName) {
      await Customer.findOneAndUpdate(
        { name: newOrder.customerName },
        {
          name: newOrder.customerName,
          phone: newOrder.customerPhone || '',
          address: newOrder.customerAddress || ''
        },
        { upsert: true, new: true, setDefaultsOnInsert: true }
      );
    }

    // After order is created, upsert order route
    if (newOrder.orderRoute) {
      await Route.findOneAndUpdate(
        { name: newOrder.orderRoute },
        {
          name: newOrder.orderRoute,
          createdBy: req.user.id
        },
        { upsert: true, new: true, setDefaultsOnInsert: true }
      );
    }

    res.status(201).json(newOrder);
  } catch (err) {
    console.error('Order creation failed:', err);
    res.status(400).json({ message: err.message });
  }
});

// Update order by orderId with role check
router.put('/by-order-id/:orderId', verifyToken, async (req, res) => {
  try {
    const user = await User.findById(req.user.id);
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    const order = await Order.findOne({ orderId: req.params.orderId });
    if (!order) {
      return res.status(404).json({ message: 'Order not found' });
    }

    // Check permissions based on role
    if (user.role === 'Executive') {
      // Executive can only update their own orders
      if (order.createdBy !== user.name) {
        return res.status(403).json({ 
          message: 'Access denied. You can only update orders created by you.' 
        });
      }
    } else if (!['Admin', 'Staff'].includes(user.role)) {
      return res.status(403).json({ message: 'Unauthorized access' });
    }

    // Validate status transition - Strict workflow enforcement
    if (req.body.orderStatus && req.body.orderStatus !== order.orderStatus) {
      const validTransitions = {
        'Pending': ['DC'],
        'DC': ['Invoice'],
        'Invoice': ['Dispatched'],
        'Dispatched': [] // Final state, no further transitions
      };

      const currentStatus = order.orderStatus;
      const newStatus = req.body.orderStatus;
      const allowedNextStatuses = validTransitions[currentStatus] || [];

      if (!allowedNextStatuses.includes(newStatus)) {
        return res.status(400).json({
          message: `Invalid status transition: Cannot change from '${currentStatus}' to '${newStatus}'. Allowed transitions: ${allowedNextStatuses.join(', ') || 'None (final state)'}`
        });
      }

      // Additional validation for Dispatched status
      if (newStatus === 'Dispatched' && !req.body.deliveryPartner) {
        return res.status(400).json({ 
          message: 'Cannot mark as Dispatched: Please select a delivery partner'
        });
      }
    }

    // Check if order should be marked as isWithout (assigned to Gaurav Miniyar)
    const isWithout = req.body.assignedToId === '685a4143374df5c794581187';

    // Prepare update data
    let updateData = {
      ...req.body, // additionalNotes will be included if present
      isWithout, // Set the isWithout field based on assignment
      // If status is being updated, record who did it
      ...(req.body.orderStatus !== order.orderStatus && {
        statusUpdatedBy: req.user.id,
        statusUpdatedAt: new Date()
      })
    };

    // Handle stock management for order updates
    let stockUpdated = false;
    let updatedProducts = [];

    // If orderItems are present in update, handle stock changes
    if (Array.isArray(req.body.orderItems)) {
      // Validate stock availability for new quantities
      const stockErrors = await validateStockAvailability(req.body.orderItems);
      if (stockErrors.length > 0) {
        return res.status(400).json({ 
          message: 'Insufficient stock for some products',
          stockErrors 
        });
      }

      // Restore stock from original order items
      if (order.orderItems && order.orderItems.length > 0) {
        await updateProductStock(order.orderItems, 'increase');
      }

      // Decrease stock for new order items
      let enrichedUpdateItems = [...req.body.orderItems];
      if (enrichedUpdateItems.length > 0) {
        const productIds = enrichedUpdateItems.map((it) => it.productId).filter(Boolean);
        const products = await Product.find({ _id: { $in: productIds } }, 'brandName');
        const idToBrand = new Map(products.map((p) => [String(p._id), p.brandName]));
        enrichedUpdateItems = enrichedUpdateItems.map((it) => ({
          ...it,
          brandName: it.brandName || idToBrand.get(String(it.productId)) || null,
        }));
        
        updatedProducts = await updateProductStock(enrichedUpdateItems, 'decrease');
        stockUpdated = true;
      }
      updateData.orderItems = enrichedUpdateItems;
    }

    const updatedOrder = await Order.findOneAndUpdate(
      { orderId: req.params.orderId },
      updateData,
      { new: true }
    );

    // Check for low stock alerts if stock was updated
    if (stockUpdated && updatedProducts.length > 0) {
      const lowStockProducts = await checkLowStockAlerts(updatedProducts);
      if (lowStockProducts.length > 0) {
        console.log('Low stock alert:', lowStockProducts.map(p => `${p.name}: ${p.stockQuantity}/${p.lowStockThreshold}`));
      }
    }

    // Emit WebSocket event for order update
    emitOrderUpdated(updatedOrder, {
      id: req.user.id,
      name: req.user.name,
      role: req.user.role
    });

    res.json(updatedOrder);
  } catch (err) {
    console.error('Order update failed:', err);
    res.status(400).json({ message: err.message });
  }
});

// Delete order - Admin only
router.delete('/by-order-id/:orderId', verifyToken, isAdmin, async (req, res) => {
  try {
    // Get order details before deletion for WebSocket event
    const orderToDelete = await Order.findOne({ orderId: req.params.orderId });
    
    if (!orderToDelete) {
      return res.status(404).json({ message: 'Order not found' });
    }

    // Restore stock quantities when order is deleted
    if (orderToDelete.orderItems && orderToDelete.orderItems.length > 0) {
      await updateProductStock(orderToDelete.orderItems, 'increase');
    }
    
    const order = await Order.findOneAndDelete({ orderId: req.params.orderId });
    
    // Emit WebSocket event for order deletion
    emitOrderDeleted(
      orderToDelete.orderId,
      orderToDelete.customerName || 'Order',
      {
        id: req.user.id,
        name: req.user.name,
        role: req.user.role
      }
    );
    
    res.json({ message: 'Order deleted successfully' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Cancel order and restore stock - Admin and Staff only
router.post('/cancel/:orderId', verifyToken, isStaffOrAdmin, async (req, res) => {
  try {
    const user = await User.findById(req.user.id);
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    const order = await Order.findOne({ orderId: req.params.orderId });
    if (!order) {
      return res.status(404).json({ message: 'Order not found' });
    }

    // Check if order can be cancelled (not already cancelled or completed)
    if (order.status === 'cancelled') {
      return res.status(400).json({ message: 'Order is already cancelled' });
    }

    if (order.orderStatus === 'Dispatched') {
      return res.status(400).json({ message: 'Cannot cancel dispatched orders' });
    }

    // Restore stock quantities when order is cancelled
    if (order.orderItems && order.orderItems.length > 0) {
      await updateProductStock(order.orderItems, 'increase');
    }

    // Update order status to cancelled
    const updatedOrder = await Order.findOneAndUpdate(
      { orderId: req.params.orderId },
      { 
        status: 'cancelled',
        orderStatus: 'Cancelled',
        cancelledBy: user.name,
        cancelledAt: new Date(),
        cancellationReason: req.body.reason || 'Cancelled by admin'
      },
      { new: true }
    );

    // Emit WebSocket event for order cancellation
    emitOrderUpdated(updatedOrder, {
      id: req.user.id,
      name: req.user.name,
      role: req.user.role
    });

    res.json({ 
      message: 'Order cancelled successfully',
      order: updatedOrder
    });
  } catch (err) {
    console.error('Order cancellation failed:', err);
    res.status(500).json({ message: err.message });
  }
});

// Get stock status for products in an order
router.get('/stock-status/:orderId', verifyToken, async (req, res) => {
  try {
    const order = await Order.findOne({ orderId: req.params.orderId });
    if (!order) {
      return res.status(404).json({ message: 'Order not found' });
    }

    const stockStatus = [];
    for (const item of order.orderItems) {
      if (!item.productId) continue;
      
      const product = await Product.findById(item.productId);
      if (!product) continue;
      
      stockStatus.push({
        productId: item.productId,
        productName: item.name || product.name,
        requiredQuantity: item.qty,
        availableStock: product.stockQuantity,
        sufficient: product.stockQuantity >= item.qty,
        lowStock: product.stockQuantity <= product.lowStockThreshold
      });
    }

    res.json({ stockStatus });
  } catch (err) {
    console.error('Stock status check failed:', err);
    res.status(500).json({ message: err.message });
  }
});

module.exports = router; 