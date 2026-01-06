const express = require('express');
const router = express.Router();
const User = require('../models/User');
const { verifyToken, isAdmin } = require('../middleware/auth');
const { sendNotificationWithRetry } = require('../services/notificationService');

// Get all staff members
router.get('/', verifyToken, async (req, res) => {
  try {
    const staff = await User.find({ role: { $in: ['Admin', 'Staff', 'Executive', 'Inventory Manager'] } }).select('-password');
    res.json(staff);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Create new staff member - Admin only
router.post('/', verifyToken, isAdmin, async (req, res) => {
  // Only Admin can create Inventory Manager
  if (req.body.role === 'Inventory Manager') {
    const user = await User.findById(req.user.id);
    if (!user || user.role !== 'Admin') {
      return res.status(403).json({ message: 'Access denied. Only Admin can create Inventory Manager.' });
    }
  }
  
  const staff = new User(req.body);
  try {
    const newStaff = await staff.save();
    const { password, ...staffWithoutPassword } = newStaff.toObject();
    
    // Send push notification
    const user = await User.findById(req.user.id);
    sendNotificationWithRetry('staff_created', {
      staffId: newStaff._id.toString(),
      staffName: newStaff.name,
      role: newStaff.role,
    }).catch(err => console.error('Error sending staff_created notification:', err));
    
    res.status(201).json(staffWithoutPassword);
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});

// Update staff member - Admin only
router.put('/:id', verifyToken, isAdmin, async (req, res) => {
  try {
    const updatedStaff = await User.findByIdAndUpdate(
      req.params.id,
      req.body,
      { new: true }
    ).select('-password');
    
    // Send push notification
    sendNotificationWithRetry('staff_updated', {
      staffId: updatedStaff._id.toString(),
      staffName: updatedStaff.name,
    }).catch(err => console.error('Error sending staff_updated notification:', err));
    
    res.json(updatedStaff);
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});

// Delete staff member - Admin only
router.delete('/:id', verifyToken, isAdmin, async (req, res) => {
  try {
    const staffToDelete = await User.findById(req.params.id);
    
    if (!staffToDelete) {
      return res.status(404).json({ message: 'Staff member not found' });
    }

    await User.findByIdAndDelete(req.params.id);
    
    // Send push notification
    sendNotificationWithRetry('staff_deleted', {
      staffId: staffToDelete._id.toString(),
      staffName: staffToDelete.name,
    }).catch(err => console.error('Error sending staff_deleted notification:', err));
    
    res.json({ message: 'Staff member deleted successfully' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

module.exports = router; 