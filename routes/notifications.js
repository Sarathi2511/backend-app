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

// Get current user's notification preferences
router.get('/preferences', verifyToken, async (req, res) => {
  try {
    const user = await User.findById(req.user.id).select('notificationPreferences pushToken');

    if (!user) {
      return res.status(404).json({ 
        success: false, 
        message: 'User not found' 
      });
    }

    res.json({ 
      success: true, 
      preferences: user.notificationPreferences || {
        orderNotifications: true,
        inventoryNotifications: true,
        staffNotifications: true,
        systemNotifications: true,
      },
      hasPushToken: !!user.pushToken
    });
  } catch (err) {
    console.error('Error fetching notification preferences:', err);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to fetch notification preferences',
      error: err.message 
    });
  }
});

// Update notification preferences
router.put('/preferences', verifyToken, async (req, res) => {
  try {
    const { orderNotifications, inventoryNotifications, staffNotifications, systemNotifications } = req.body;

    const updateData = {};
    if (typeof orderNotifications === 'boolean') {
      updateData['notificationPreferences.orderNotifications'] = orderNotifications;
    }
    if (typeof inventoryNotifications === 'boolean') {
      updateData['notificationPreferences.inventoryNotifications'] = inventoryNotifications;
    }
    if (typeof staffNotifications === 'boolean') {
      updateData['notificationPreferences.staffNotifications'] = staffNotifications;
    }
    if (typeof systemNotifications === 'boolean') {
      updateData['notificationPreferences.systemNotifications'] = systemNotifications;
    }

    if (Object.keys(updateData).length === 0) {
      return res.status(400).json({ 
        success: false, 
        message: 'No valid preferences provided' 
      });
    }

    const user = await User.findByIdAndUpdate(
      req.user.id,
      { $set: updateData },
      { new: true }
    ).select('notificationPreferences');

    if (!user) {
      return res.status(404).json({ 
        success: false, 
        message: 'User not found' 
      });
    }

    res.json({ 
      success: true, 
      message: 'Notification preferences updated successfully',
      preferences: user.notificationPreferences 
    });
  } catch (err) {
    console.error('Error updating notification preferences:', err);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to update notification preferences',
      error: err.message 
    });
  }
});

module.exports = router;
