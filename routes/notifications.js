const express = require('express');
const router = express.Router();
const User = require('../models/User');
const { verifyToken } = require('../middleware/auth');
const { getMessaging } = require('../config/firebase');

// Register push token for a user (now accepts FCM tokens)
router.post('/register-token', verifyToken, async (req, res) => {
  try {
    const { pushToken } = req.body;

    if (!pushToken) {
      return res.status(400).json({ 
        success: false, 
        message: 'Push token is required' 
      });
    }

    // FCM tokens are typically long strings (150+ characters)
    // They don't have a specific prefix like Expo tokens
    if (typeof pushToken !== 'string' || pushToken.length < 100) {
      return res.status(400).json({ 
        success: false, 
        message: 'Invalid push token format. Expected FCM token.' 
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

// Test endpoint to send a test notification to the current user via FCM
router.post('/test', verifyToken, async (req, res) => {
  try {
    const user = await User.findById(req.user.id);
    
    if (!user) {
      return res.status(404).json({ 
        success: false, 
        message: 'User not found' 
      });
    }

    if (!user.pushToken) {
      return res.status(400).json({ 
        success: false, 
        message: 'No push token registered for this user',
        userId: user._id,
        userName: user.name
      });
    }

    // Get Firebase Messaging instance
    const messaging = getMessaging();
    
    // Build FCM message
    const message = {
      token: user.pushToken,
      notification: {
        title: 'Test Notification 🎉',
        body: `Hello ${user.name}! This is a test notification from Sarathi.`,
      },
      data: {
        type: 'test',
        timestamp: String(Date.now()),
      },
      android: {
        priority: 'high',
        notification: {
          channelId: 'default',
          sound: 'default',
        },
      },
    };

    console.log('Sending test FCM notification to:', user.pushToken.substring(0, 20) + '...');

    const response = await messaging.send(message);
    console.log('FCM response:', response);

    res.json({ 
      success: true, 
      message: 'Test notification sent successfully via FCM',
      messageId: response,
      sentTo: {
        userId: user._id,
        userName: user.name,
        tokenPreview: user.pushToken.substring(0, 20) + '...'
      }
    });
  } catch (err) {
    console.error('Error sending test notification:', err);
    
    // Handle specific FCM errors
    let errorMessage = err.message;
    if (err.code === 'messaging/invalid-registration-token') {
      errorMessage = 'Invalid FCM token. Please re-register the device.';
      // Clear invalid token
      await User.findByIdAndUpdate(req.user.id, { pushToken: null });
    } else if (err.code === 'messaging/registration-token-not-registered') {
      errorMessage = 'FCM token is no longer registered. Please re-register the device.';
      // Clear invalid token
      await User.findByIdAndUpdate(req.user.id, { pushToken: null });
    }
    
    res.status(500).json({ 
      success: false, 
      message: 'Failed to send test notification',
      error: errorMessage,
      code: err.code
    });
  }
});

module.exports = router;
