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

// Create new order with role check and partial fulfillment support
router.post('/', verifyToken, canCreateOrders, async (req, res) => {
  try {
    const user = await User.findById(req.user.id);
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    const { assignedTo, assignedToId, scheduledFor, orderItems } = req.body;
    
    if (!assignedTo || !assignedToId) {
      return res.status(400).json({ message: 'Assigned To and Assigned To ID are required.' });
    }

    // No stock validation at order creation - all items are included
    // Partial fulfillment will be handled at dispatch time

    // Check if at least one item is provided
    if (!orderItems || orderItems.length === 0) {
        return res.status(400).json({ 
        message: 'Please add at least one item to the order.' 
      });
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

    // Enrich all items with brandName from products
    let enrichedOrderItems = [];
    if (orderItems.length > 0) {
      const productIds = orderItems.map((it) => it.productId).filter(Boolean);
      const products = await Product.find({ _id: { $in: productIds } }, 'brandName');
      const idToBrand = new Map(products.map((p) => [String(p._id), p.brandName]));
      enrichedOrderItems = orderItems.map((it) => ({
        ...it,
        brandName: it.brandName || idToBrand.get(String(it.productId)) || null,
      }));
    }

    const order = new Order({
      ...req.body, // additionalNotes will be included if present
      orderItems: enrichedOrderItems, // All items go into orderItems initially
      assignedTo,
      assignedToId,
      orderId,
      date,
      scheduledFor: scheduledDate,
      status,
      createdBy: user.name, // Ensure createdBy is set to the current user's name
      isWithout, // Set the isWithout field based on assignment
      // No partial fulfillment fields at creation - will be set at dispatch time
      isPartialOrder: false,
      partialItems: [],
      originalItemCount: orderItems.length,
      fulfilledItemCount: orderItems.length
    });
    const newOrder = await order.save();

    // No stock update at order creation - stock will be updated at dispatch time
    
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

    // Validate status transition - Flexible workflow enforcement
    if (req.body.orderStatus && req.body.orderStatus !== order.orderStatus) {
      const validTransitions = {
        'Pending': ['DC'],
        'DC': ['Invoice', 'Dispatched'], // Allow both Invoice and Dispatched from DC
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
      if (newStatus === 'Dispatched') {
        if (!req.body.deliveryPartner) {
        return res.status(400).json({ 
          message: 'Cannot mark as Dispatched: Please select a delivery partner'
        });
        }
        
        // Handle partial fulfillment at dispatch time
        if (req.body.dispatchItems && Array.isArray(req.body.dispatchItems)) {
          // This is a dispatch with item selection
          const dispatchItems = req.body.dispatchItems;
          const allOrderItems = order.orderItems;
          
          // Validate stock for items being dispatched
          const itemsToDispatch = allOrderItems.filter((_, index) => dispatchItems.includes(index));
          const stockErrors = await validateStockAvailability(itemsToDispatch);
          if (stockErrors.length > 0) {
            return res.status(400).json({ 
              message: 'Insufficient stock for some items being dispatched',
              stockErrors 
            });
          }
          
          // Create partial order if not all items are being dispatched
          const itemsNotDispatched = allOrderItems.filter((_, index) => !dispatchItems.includes(index));
          
          if (itemsNotDispatched.length > 0) {
            // This is a partial dispatch
            updateData.orderItems = itemsToDispatch;
            updateData.partialItems = itemsNotDispatched;
            updateData.isPartialOrder = true;
            updateData.fulfilledItemCount = itemsToDispatch.length;
            
            // Update stock only for dispatched items
            await updateProductStock(itemsToDispatch, 'decrease');
          } else {
            // Full dispatch - all items are being dispatched
            updateData.isPartialOrder = false;
            updateData.partialItems = [];
            updateData.fulfilledItemCount = allOrderItems.length;
            
            // Update stock for all items
            await updateProductStock(allOrderItems, 'decrease');
          }
        } else {
          // No item selection provided - dispatch all items
          const stockErrors = await validateStockAvailability(order.orderItems);
          if (stockErrors.length > 0) {
            return res.status(400).json({ 
              message: 'Insufficient stock for some items',
              stockErrors 
            });
          }
          
          // Update stock for all items
          await updateProductStock(order.orderItems, 'decrease');
        }
      }
    }

    // Handle partial order completion
    if (req.body.completePartialOrder && order.isPartialOrder) {
      const { itemsToAdd } = req.body;
      
      if (!Array.isArray(itemsToAdd) || itemsToAdd.length === 0) {
        return res.status(400).json({ 
          message: 'No items provided to complete partial order' 
        });
      }

      // Validate stock availability for items to add
      const stockErrors = await validateStockAvailability(itemsToAdd);
      if (stockErrors.length > 0) {
        return res.status(400).json({ 
          message: 'Insufficient stock for items to add',
          stockErrors 
        });
      }

      // Enrich items to add with brandName
      let enrichedItemsToAdd = [...itemsToAdd];
      if (enrichedItemsToAdd.length > 0) {
        const productIds = enrichedItemsToAdd.map((it) => it.productId).filter(Boolean);
        const products = await Product.find({ _id: { $in: productIds } }, 'brandName');
        const idToBrand = new Map(products.map((p) => [String(p._id), p.brandName]));
        enrichedItemsToAdd = enrichedItemsToAdd.map((it) => ({
          ...it,
          brandName: it.brandName || idToBrand.get(String(it.productId)) || null,
        }));
      }

      // Add new items to existing order items
      const updatedOrderItems = [...order.orderItems, ...enrichedItemsToAdd];
      
      // Remove added items from partial items
      const remainingPartialItems = order.partialItems.filter(partialItem => 
        !enrichedItemsToAdd.some(newItem => 
          newItem.productId.toString() === partialItem.productId.toString()
        )
      );

      // Update partial fulfillment fields
      updateData.orderItems = updatedOrderItems;
      updateData.partialItems = remainingPartialItems;
      updateData.fulfilledItemCount = updatedOrderItems.length;
      
      // Check if order is now complete
      if (remainingPartialItems.length === 0) {
        updateData.isPartialOrder = false;
        updateData.partialItems = [];
      }

      // Deduct stock for new items
      await updateProductStock(enrichedItemsToAdd, 'decrease');
      
      // Emit WebSocket event for partial order completion
      emitOrderUpdated({
        ...order.toObject(),
        ...updateData
      }, {
        id: req.user.id,
        name: req.user.name,
        role: req.user.role
      });

      const updatedOrder = await Order.findOneAndUpdate(
        { orderId: req.params.orderId },
        updateData,
        { new: true }
      );

      return res.json(updatedOrder);
    }

    // Handle stock management for regular order updates
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

// Get dispatch confirmation data (for orders being dispatched)
router.get('/dispatch-confirmation/:orderId', verifyToken, async (req, res) => {
  try {
    const order = await Order.findOne({ orderId: req.params.orderId });
    if (!order) {
      return res.status(404).json({ message: 'Order not found' });
    }

    // Check stock availability for all order items
    const itemsWithStock = [];
    for (const item of order.orderItems) {
      if (!item.productId) continue;
      
      const product = await Product.findById(item.productId);
      if (!product) continue;
      
      itemsWithStock.push({
        ...item,
        // Ensure we have the correct item name from product if missing
        name: item.name || product.name,
        // Ensure we have all required fields
        qty: item.qty || 0,
        price: item.price || 0,
        total: item.total || (item.qty * item.price) || 0,
        availableStock: product.stockQuantity,
        canFulfill: product.stockQuantity >= (item.qty || 0),
        lowStock: product.stockQuantity <= product.lowStockThreshold
      });
    }

    res.json({
      orderId: order.orderId,
      customerName: order.customerName,
      orderItems: itemsWithStock,
      totalItems: order.orderItems.length,
      canFulfillAll: itemsWithStock.every(item => item.canFulfill)
    });
  } catch (err) {
    console.error('Dispatch confirmation data failed:', err);
    res.status(500).json({ message: err.message });
  }
});

// Get partial order details
router.get('/partial-details/:orderId', verifyToken, async (req, res) => {
  try {
    const order = await Order.findOne({ orderId: req.params.orderId });
    if (!order) {
      return res.status(404).json({ message: 'Order not found' });
    }

    if (!order.isPartialOrder) {
      return res.status(400).json({ message: 'This is not a partial order' });
    }

    // Check stock availability for partial items
    const partialItemsWithStock = [];
    for (const item of order.partialItems) {
      if (!item.productId) continue;
      
      const product = await Product.findById(item.productId);
      if (!product) continue;
      
      partialItemsWithStock.push({
        ...item,
        availableStock: product.stockQuantity,
        canFulfill: product.stockQuantity >= item.qty,
        lowStock: product.stockQuantity <= product.lowStockThreshold
      });
    }

    res.json({
      isPartialOrder: order.isPartialOrder,
      partialItems: partialItemsWithStock,
      originalItemCount: order.originalItemCount,
      fulfilledItemCount: order.fulfilledItemCount,
      pendingItemCount: order.partialItems.length
    });
  } catch (err) {
    console.error('Partial order details check failed:', err);
    res.status(500).json({ message: err.message });
  }
});

module.exports = router; 