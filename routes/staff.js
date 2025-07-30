const express = require('express');
const router = express.Router();
const User = require('../models/User');
const { verifyToken, isAdmin } = require('../middleware/auth');
const { emitStaffCreated, emitStaffUpdated, emitStaffDeleted } = require('../socket/events');

// Get all staff members
router.get('/', verifyToken, async (req, res) => {
  try {
    const staff = await User.find({ role: { $in: ['Staff', 'Executive'] } }).select('-password');
    res.json(staff);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Create new staff member - Admin only
router.post('/', verifyToken, isAdmin, async (req, res) => {
  const staff = new User(req.body);
  try {
    const newStaff = await staff.save();
    const { password, ...staffWithoutPassword } = newStaff.toObject();
    
    // Emit WebSocket event for staff creation
    emitStaffCreated(staffWithoutPassword, {
      id: req.user.id,
      name: req.user.name,
      role: req.user.role
    });
    
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
    
    // Emit WebSocket event for staff update
    emitStaffUpdated(updatedStaff, {
      id: req.user.id,
      name: req.user.name,
      role: req.user.role
    });
    
    res.json(updatedStaff);
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});

// Delete staff member - Admin only
router.delete('/:id', verifyToken, isAdmin, async (req, res) => {
  try {
    // Get staff details before deletion for WebSocket event
    const staffToDelete = await User.findById(req.params.id);
    
    await User.findByIdAndDelete(req.params.id);
    
    // Emit WebSocket event for staff deletion
    if (staffToDelete) {
      emitStaffDeleted(
        staffToDelete._id,
        staffToDelete.name,
        {
          id: req.user.id,
          name: req.user.name,
          role: req.user.role
        }
      );
    }
    
    res.json({ message: 'Staff member deleted successfully' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

module.exports = router; 