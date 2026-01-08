const express = require('express');
const router = express.Router();
const User = require('../models/User');
const { verifyToken } = require('../middleware/auth');

// Register push token for a user
router.post('/register-token', verifyToken, async (req, res) => {
  try {
    const { pushToken } = req.body;

    if (!pushToken) {
      return res.status(400).json({ 
        success: false, 
        message: 'Push token is required' 
      });
    }

    // Validate Expo push token format (starts with ExponentPushToken or ExpoPushToken)
    if (!pushToken.startsWith('ExponentPushToken[') && !pushToken.startsWith('ExpoPushToken[')) {
      return res.status(400).json({ 
        success: false, 
        message: 'Invalid push token format' 
      });
    }

    // Update user's push token
    const user = await User.findByIdAndUpdate(
      req.user.id,
      { pushToken: pushToken },
      { new: true }
    ).select('-password');

    if (!user) {
      return res.status(404).json({ 
        success: false, 
        message: 'User not found' 
      });
    }

    res.json({ 
      success: true, 
      message: 'Push token registered successfully',
      user: {
        id: user._id,
        name: user.name,
        role: user.role,
        hasPushToken: !!user.pushToken
      }
    });
  } catch (err) {
    console.error('Error registering push token:', err);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to register push token',
      error: err.message 
    });
  }
});

// Unregister push token (remove token when user logs out)
router.delete('/unregister-token', verifyToken, async (req, res) => {
  try {
    const user = await User.findByIdAndUpdate(
      req.user.id,
      { pushToken: null },
      { new: true }
    ).select('-password');

    if (!user) {
      return res.status(404).json({ 
        success: false, 
        message: 'User not found' 
      });
    }

    res.json({ 
      success: true, 
      message: 'Push token unregistered successfully' 
    });
  } catch (err) {
    console.error('Error unregistering push token:', err);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to unregister push token',
      error: err.message 
    });
  }
});

module.exports = router;
