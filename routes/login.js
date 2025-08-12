const express = require('express');
const router = express.Router();
const User = require('../models/User');
const jwt = require('jsonwebtoken');
const { verifyToken } = require('../middleware/auth');

router.post('/', async (req, res) => {
  const { phone, password } = req.body;
  try {
    const user = await User.findOne({ phone, password });
    if (user) {
      // Generate JWT token
      const token = jwt.sign(
        { id: user._id, role: user.role, name: user.name },
        process.env.JWT_SECRET,
        { expiresIn: '24h' }
      );

      return res.json({
        success: true,
        token,
        role: user.role,
        name: user.name,
        userId: user._id
      });
    } else {
      return res.status(401).json({ success: false, message: 'Invalid phone number or password' });
    }
  } catch (err) {
    return res.status(500).json({ success: false, message: 'Server error' });
  }
});

module.exports = router; 

// Add token validation route
router.get('/validate', verifyToken, async (req, res) => {
  try {
    const user = await User.findById(req.user.id).select('-password');
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }
    return res.json({
      success: true,
      user: {
        id: user._id,
        name: user.name,
        role: user.role,
        phone: user.phone,
      }
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: 'Server error' });
  }
});