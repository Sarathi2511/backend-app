const express = require('express');
const router = express.Router();
const Order = require('../models/Order');
const User = require('../models/User');
const { verifyToken, isAdmin, isStaffOrAdmin, canCreateOrders, canModifyOrders } = require('../middleware/auth');
const { emitOrderCreated, emitOrderUpdated, emitOrderDeleted } = require('../socket/events');

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
    const isWithout = assignedToId === '688f027498b9e935ae3ca6ed';

    const order = new Order({
      ...req.body,
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
    
    // Emit WebSocket event for order creation
    emitOrderCreated(newOrder, {
      id: req.user.id,
      name: req.user.name,
      role: req.user.role
    });
    
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
    const isWithout = req.body.assignedToId === '688f027498b9e935ae3ca6ed';

    // Prepare update data
    const updateData = {
      ...req.body,
      isWithout, // Set the isWithout field based on assignment
      // If status is being updated, record who did it
      ...(req.body.orderStatus !== order.orderStatus && {
        statusUpdatedBy: req.user.id,
        statusUpdatedAt: new Date()
      })
    };

    const updatedOrder = await Order.findOneAndUpdate(
      { orderId: req.params.orderId },
      updateData,
      { new: true }
    );

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
    
    const order = await Order.findOneAndDelete({ orderId: req.params.orderId });
    if (!order) {
      return res.status(404).json({ message: 'Order not found' });
    }
    
    // Emit WebSocket event for order deletion
    if (orderToDelete) {
      emitOrderDeleted(
        orderToDelete.orderId,
        orderToDelete.customerName || 'Order',
        {
          id: req.user.id,
          name: req.user.name,
          role: req.user.role
        }
      );
    }
    
    res.json({ message: 'Order deleted successfully' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

module.exports = router; 