const express = require('express');
const router = express.Router();
const Order = require('../models/Order');
const User = require('../models/User');
const Customer = require('../models/Customer');
const Route = require('../models/Route');
const Product = require('../models/Product');
const { verifyToken, isAdmin, isStaffOrAdmin, canCreateOrders, canModifyOrders } = require('../middleware/auth');
const { sendNotificationWithRetry } = require('../services/notificationService');

// Get orders based on role
router.get('/', verifyToken, async (req, res) => {
  try {
    const user = await User.findById(req.user.id);
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    let orders;
    // Admin, Staff, and Inventory Manager can see all orders
    if (['Admin', 'Staff', 'Inventory Manager'].includes(user.role)) {
      orders = await Order.find().populate('statusUpdatedBy', 'name').populate('statusHistory.updatedBy', 'name');
    }
    // Executive can only see their own orders
    else if (user.role === 'Executive') {
      orders = await Order.find({ createdBy: user.name }).populate('statusUpdatedBy', 'name').populate('statusHistory.updatedBy', 'name');
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

    const order = await Order.findOne({ orderId: req.params.orderId }).populate('statusUpdatedBy', 'name').populate('statusHistory.updatedBy', 'name');
    if (!order) {
      return res.status(404).json({ message: 'Order not found' });
    }

    // Check permissions based on role
    // Admin, Staff, and Inventory Manager can view all orders
    if (user.role === 'Executive' && order.createdBy !== user.name) {
      return res.status(403).json({ message: 'Access denied. You can only view orders created by you.' });
    }
    if (!['Admin', 'Staff', 'Inventory Manager', 'Executive'].includes(user.role)) {
      return res.status(403).json({ message: 'Unauthorized access' });
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
    const orders = await Order.find({ assignedToId: req.params.userId }).populate('statusUpdatedBy', 'name').populate('statusHistory.updatedBy', 'name');
    res.json(orders);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Get orders by status - for Inventory Manager to get "Inv Check" orders
router.get('/by-status/:status', verifyToken, async (req, res) => {
  try {
    const user = await User.findById(req.user.id);
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    const status = req.params.status;
    
    // Only allow Inventory Manager, Admin, and Staff to filter by status
    if (!['Admin', 'Staff', 'Inventory Manager'].includes(user.role)) {
      return res.status(403).json({ message: 'Unauthorized access' });
    }

    const orders = await Order.find({ orderStatus: status }).populate('statusUpdatedBy', 'name').populate('statusHistory.updatedBy', 'name');
    res.json(orders);
  } catch (err) {
    console.error('Error fetching orders by status:', err);
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

    const { assignedTo, assignedToId, orderItems } = req.body;
    
    if (!assignedTo || !assignedToId) {
      return res.status(400).json({ message: 'Assigned To and Assigned To ID are required.' });
    }

    // Check if at least one item is provided
    if (!orderItems || orderItems.length === 0) {
        return res.status(400).json({ 
        message: 'Please add at least one item to the order.' 
      });
    }

    const orderId = await generateOrderId();

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
      date: new Date(),
      status: 'active',
      createdBy: user.name, // Ensure createdBy is set to the current user's name
      isWithout, // Set the isWithout field based on assignment
      statusUpdatedBy: req.user.id, // Set who created/updated the initial status
      statusUpdatedAt: new Date(), // Set when the initial status was set
      statusHistory: [{
        status: req.body.orderStatus || 'Pending',
        updatedBy: req.user.id,
        updatedAt: new Date()
      }]
    });
    
    const newOrder = await order.save();
    
    // Populate statusHistory for response
    const populatedOrder = await Order.findById(newOrder._id)
      .populate('statusUpdatedBy', 'name')
      .populate('statusHistory.updatedBy', 'name');
    
    // After order is created, upsert customer name
    if (populatedOrder.customerName) {
      await Customer.findOneAndUpdate(
        { name: populatedOrder.customerName },
        {
          name: populatedOrder.customerName,
          phone: populatedOrder.customerPhone || '',
          address: populatedOrder.customerAddress || ''
        },
        { upsert: true, new: true, setDefaultsOnInsert: true }
      );
    }

    // After order is created, upsert order route
    if (populatedOrder.orderRoute) {
      await Route.findOneAndUpdate(
        { name: populatedOrder.orderRoute },
        {
          name: populatedOrder.orderRoute,
          createdBy: req.user.id
        },
        { upsert: true, new: true, setDefaultsOnInsert: true }
      );
    }

    // Send push notifications
    // Notify assigned user
    sendNotificationWithRetry('order_assigned_to_me', {
      orderId: populatedOrder.orderId,
      customerName: populatedOrder.customerName,
    }, {
      assignedToId: populatedOrder.assignedToId,
    }).catch(err => console.error('Error sending order_assigned notification:', err));

    // Notify Admin, Staff, Inventory Manager
    sendNotificationWithRetry('order_created', {
      orderId: populatedOrder.orderId,
      customerName: populatedOrder.customerName,
      createdBy: user.name,
    }).catch(err => console.error('Error sending order_created notification:', err));

    res.status(201).json(populatedOrder);
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
    } else if (user.role === 'Inventory Manager') {
      // Inventory Manager can only view orders, not update them
      return res.status(403).json({ 
        message: 'Access denied. Inventory Manager can only view orders.' 
      });
    } else if (!['Admin', 'Staff'].includes(user.role)) {
      return res.status(403).json({ message: 'Unauthorized access' });
    }

    // Check if order should be marked as isWithout (assigned to Gaurav Miniyar)
    const isWithout = req.body.assignedToId === '685a4143374df5c794581187';

    // Prepare update data
    const isStatusChanging = req.body.orderStatus && req.body.orderStatus !== order.orderStatus;
    let updateData = {
      ...req.body, // additionalNotes will be included if present
      isWithout, // Set the isWithout field based on assignment
      // If status is being updated, record who did it
      ...(isStatusChanging && {
        statusUpdatedBy: req.user.id,
        statusUpdatedAt: new Date()
      })
    };
    
    // Remove orderStatus from updateData if status is changing (we'll update it with $set and add to history)
    let statusHistoryUpdate = null;
    if (isStatusChanging) {
      statusHistoryUpdate = {
        status: req.body.orderStatus,
        updatedBy: req.user.id,
        updatedAt: new Date()
      };
      // We'll handle statusHistory update separately using $push
    }

    // Validate status transition - Flexible workflow enforcement
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
      if (newStatus === 'Dispatched') {
        if (!req.body.deliveryPartner) {
          return res.status(400).json({ 
            message: 'Cannot mark as Dispatched: Please select a delivery partner'
          });
        }
      }
    }

    // If orderItems are present in update, enrich with brandName
    if (Array.isArray(req.body.orderItems)) {
      let enrichedUpdateItems = [...req.body.orderItems];
      if (enrichedUpdateItems.length > 0) {
        const productIds = enrichedUpdateItems.map((it) => it.productId).filter(Boolean);
        const products = await Product.find({ _id: { $in: productIds } }, 'brandName');
        const idToBrand = new Map(products.map((p) => [String(p._id), p.brandName]));
        enrichedUpdateItems = enrichedUpdateItems.map((it) => ({
          ...it,
          brandName: it.brandName || idToBrand.get(String(it.productId)) || null,
        }));
      }
      updateData.orderItems = enrichedUpdateItems;
    }

    // Build final update object with $push for statusHistory if status is changing
    let finalUpdate = updateData;
    if (statusHistoryUpdate) {
      finalUpdate = {
        ...updateData,
        $push: { statusHistory: statusHistoryUpdate }
      };
    }
    
    const updatedOrder = await Order.findOneAndUpdate(
      { orderId: req.params.orderId },
      finalUpdate,
      { new: true }
    ).populate('statusUpdatedBy', 'name').populate('statusHistory.updatedBy', 'name');

    // Send push notifications for status changes
    if (isStatusChanging) {
      const oldStatus = order.orderStatus;
      const newStatus = req.body.orderStatus;
      
      // Determine notification type based on status transition
      let notificationType = 'order_status_updated';
      if (oldStatus === 'Pending' && newStatus === 'DC') {
        notificationType = 'order_status_pending_to_dc';
      } else if (oldStatus === 'DC' && newStatus === 'Invoice') {
        notificationType = 'order_status_dc_to_invoice';
      } else if (oldStatus === 'Invoice' && newStatus === 'Dispatched') {
        notificationType = 'order_status_invoice_to_dispatched';
      }

      sendNotificationWithRetry(notificationType, {
        orderId: updatedOrder.orderId,
        customerName: updatedOrder.customerName,
        newStatus: newStatus,
        deliveryPartner: updatedOrder.deliveryPartner,
      }, {
        assignedToId: updatedOrder.assignedToId,
      }).catch(err => console.error('Error sending order status notification:', err));
    }

    // Check if order was reassigned
    if (req.body.assignedToId && req.body.assignedToId.toString() !== order.assignedToId.toString()) {
      const previousAssignedUser = await User.findById(order.assignedToId).select('name');
      const newAssignedUser = await User.findById(req.body.assignedToId).select('name');
      
      sendNotificationWithRetry('order_reassigned', {
        orderId: updatedOrder.orderId,
        customerName: updatedOrder.customerName,
        newAssignee: newAssignedUser?.name || 'Unknown',
      }, {
        newAssignedToId: req.body.assignedToId,
        previousAssignedToId: order.assignedToId,
      }).catch(err => console.error('Error sending order_reassigned notification:', err));
    }

    res.json(updatedOrder);
  } catch (err) {
    console.error('Order update failed:', err);
    res.status(400).json({ message: err.message });
  }
});

// Delete order - Admin only
router.delete('/by-order-id/:orderId', verifyToken, isAdmin, async (req, res) => {
  try {
    const order = await Order.findOne({ orderId: req.params.orderId });
    
    if (!order) {
      return res.status(404).json({ message: 'Order not found' });
    }

    // Get creator user ID if exists
    const creator = await User.findOne({ name: order.createdBy }).select('_id');
    const creatorId = creator ? creator._id : null;

    await Order.findOneAndDelete({ orderId: req.params.orderId });
    
    // Send push notification
    const user = await User.findById(req.user.id);
    sendNotificationWithRetry('order_deleted', {
      orderId: order.orderId,
      customerName: order.customerName || 'Order',
      deletedBy: user?.name || 'Admin',
    }, {
      assignedToId: order.assignedToId,
      createdById: creatorId,
    }).catch(err => console.error('Error sending order_deleted notification:', err));
    
    res.json({ message: 'Order deleted successfully' });
  } catch (err) {
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
        productId: item.productId,
        // Ensure we have the correct item name from product if missing
        name: item.name || product.name,
        dimension: item.dimension || '',
        brandName: item.brandName || product.brandName || '',
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

// Dispatch order with partial delivery support and stock deduction
router.post('/dispatch/:orderId', verifyToken, async (req, res) => {
  try {
    const user = await User.findById(req.user.id);
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    // Only Admin and Staff can dispatch orders
    if (!['Admin', 'Staff'].includes(user.role)) {
      return res.status(403).json({ message: 'Unauthorized to dispatch orders' });
    }

    const order = await Order.findOne({ orderId: req.params.orderId });
    if (!order) {
      return res.status(404).json({ message: 'Order not found' });
    }

    // Validate order is in Invoice status
    if (order.orderStatus !== 'Invoice') {
      return res.status(400).json({ 
        message: `Cannot dispatch order. Order must be in 'Invoice' status. Current status: ${order.orderStatus}` 
      });
    }

    const { deliveryPartner, deliveredItems } = req.body;

    if (!deliveryPartner) {
      return res.status(400).json({ message: 'Delivery partner is required' });
    }

    if (!deliveredItems || !Array.isArray(deliveredItems)) {
      return res.status(400).json({ message: 'Delivered items data is required' });
    }

    // Validate and process each delivered item
    const updatedOrderItems = [];
    const stockUpdates = [];
    let isPartialDelivery = false;

    for (const orderItem of order.orderItems) {
      const deliveredItem = deliveredItems.find(
        di => di.productId.toString() === orderItem.productId.toString()
      );

      if (!deliveredItem) {
        // Item not included in delivery
        updatedOrderItems.push({
          ...orderItem.toObject(),
          deliveredQty: 0,
          isDelivered: false
        });
        isPartialDelivery = true;
        continue;
      }

      const deliveredQty = deliveredItem.deliveredQty || 0;
      const isDelivered = deliveredItem.isDelivered || false;

      // Validate delivered quantity
      if (deliveredQty < 0) {
        return res.status(400).json({ 
          message: `Invalid delivered quantity for ${orderItem.name}. Quantity cannot be negative.` 
        });
      }

      if (deliveredQty > orderItem.qty) {
        return res.status(400).json({ 
          message: `Delivered quantity for ${orderItem.name} (${deliveredQty}) cannot exceed ordered quantity (${orderItem.qty}).` 
        });
      }

      // Check if this results in partial delivery
      if (!isDelivered || deliveredQty < orderItem.qty) {
        isPartialDelivery = true;
      }

      // If item is marked as delivered, validate stock and prepare update
      if (isDelivered && deliveredQty > 0) {
        const product = await Product.findById(orderItem.productId);
        if (!product) {
          return res.status(400).json({ 
            message: `Product not found for ${orderItem.name}` 
          });
        }

        if (product.stockQuantity < deliveredQty) {
          return res.status(400).json({ 
            message: `Insufficient stock for ${orderItem.name}. Available: ${product.stockQuantity}, Requested: ${deliveredQty}` 
          });
        }

        // Queue stock update
        stockUpdates.push({
          productId: orderItem.productId,
          deductQty: deliveredQty
        });
      }

      updatedOrderItems.push({
        ...orderItem.toObject(),
        deliveredQty: isDelivered ? deliveredQty : 0,
        isDelivered: isDelivered
      });
    }

    // Perform stock deductions
    for (const stockUpdate of stockUpdates) {
      await Product.findByIdAndUpdate(
        stockUpdate.productId,
        { $inc: { stockQuantity: -stockUpdate.deductQty } }
      );
    }

    // Update order with dispatch information
    const updateData = {
      orderStatus: 'Dispatched',
      deliveryPartner,
      orderItems: updatedOrderItems,
      isPartialDelivery,
      dispatchedAt: new Date(),
      statusUpdatedBy: req.user.id,
      statusUpdatedAt: new Date(),
      $push: {
        statusHistory: {
          status: 'Dispatched',
          updatedBy: req.user.id,
          updatedAt: new Date()
        }
      }
    };

    const updatedOrder = await Order.findOneAndUpdate(
      { orderId: req.params.orderId },
      updateData,
      { new: true }
    ).populate('statusUpdatedBy', 'name').populate('statusHistory.updatedBy', 'name');

    // Send push notification for dispatch
    sendNotificationWithRetry('order_status_invoice_to_dispatched', {
      orderId: updatedOrder.orderId,
      customerName: updatedOrder.customerName,
      deliveryPartner: deliveryPartner,
    }, {
      assignedToId: updatedOrder.assignedToId,
    }).catch(err => console.error('Error sending dispatch notification:', err));

    res.json({
      message: isPartialDelivery ? 'Order dispatched with partial delivery' : 'Order dispatched successfully',
      order: updatedOrder,
      stockDeducted: stockUpdates.map(s => ({
        productId: s.productId,
        deductedQty: s.deductQty
      }))
    });
  } catch (err) {
    console.error('Order dispatch failed:', err);
    res.status(500).json({ message: err.message });
  }
});

// Complete order - deduct remaining stock for partially dispatched orders
router.post('/complete/:orderId', verifyToken, async (req, res) => {
  try {
    const user = await User.findById(req.user.id);
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    // Only Admin and Staff can complete orders
    if (!['Admin', 'Staff'].includes(user.role)) {
      return res.status(403).json({ message: 'Unauthorized to complete orders' });
    }

    const order = await Order.findOne({ orderId: req.params.orderId });
    if (!order) {
      return res.status(404).json({ message: 'Order not found' });
    }

    // Validate order is dispatched and has partial delivery
    if (order.orderStatus !== 'Dispatched') {
      return res.status(400).json({ 
        message: `Cannot complete order. Order must be in 'Dispatched' status. Current status: ${order.orderStatus}` 
      });
    }

    if (!order.isPartialDelivery) {
      return res.status(400).json({ 
        message: 'Order is already fully dispatched. Nothing to complete.' 
      });
    }

    // Calculate and deduct remaining stock for each item
    const stockUpdates = [];
    const updatedOrderItems = [];

    for (const orderItem of order.orderItems) {
      const deliveredQty = orderItem.deliveredQty || 0;
      const remainingQty = orderItem.qty - deliveredQty;

      // Skip items that were fully delivered
      if (remainingQty <= 0) {
        updatedOrderItems.push(orderItem.toObject());
        continue;
      }

      // Validate stock availability for remaining quantity
      const product = await Product.findById(orderItem.productId);
      if (!product) {
        return res.status(400).json({ 
          message: `Product not found for ${orderItem.name}` 
        });
      }

      if (product.stockQuantity < remainingQty) {
        return res.status(400).json({ 
          message: `Insufficient stock for ${orderItem.name}. Available: ${product.stockQuantity}, Required: ${remainingQty}` 
        });
      }

      // Queue stock update for remaining quantity
      stockUpdates.push({
        productId: orderItem.productId,
        deductQty: remainingQty
      });

      // Update order item to reflect full delivery
      updatedOrderItems.push({
        ...orderItem.toObject(),
        deliveredQty: orderItem.qty, // Set to full quantity
        isDelivered: true // Mark as fully delivered
      });
    }

    // Perform stock deductions
    for (const stockUpdate of stockUpdates) {
      await Product.findByIdAndUpdate(
        stockUpdate.productId,
        { $inc: { stockQuantity: -stockUpdate.deductQty } }
      );
    }

    // Update order - mark as fully dispatched
    const updatedOrder = await Order.findOneAndUpdate(
      { orderId: req.params.orderId },
      {
        orderItems: updatedOrderItems,
        isPartialDelivery: false, // Mark as fully dispatched
      },
      { new: true }
    ).populate('statusUpdatedBy', 'name').populate('statusHistory.updatedBy', 'name');

    res.json({
      message: 'Order completed successfully. Remaining stock has been deducted.',
      order: updatedOrder,
      stockDeducted: stockUpdates.map(s => ({
        productId: s.productId,
        deductedQty: s.deductQty
      }))
    });
  } catch (err) {
    console.error('Order completion failed:', err);
    res.status(500).json({ message: err.message });
  }
});

module.exports = router; 