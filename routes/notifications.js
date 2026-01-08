const express = require('express');
const router = express.Router();
const User = require('../models/User');
const { verifyToken } = require('../middleware/auth');

// Register push token for a user
router.post('/register-token', verifyToken, async (req, res) => {
  try {
    const { pushToken } = req.body;
    const userId = req.user.id;

    console.log(`[Token Registration] Request from user ${userId}`);
    console.log(`[Token Registration] Token received: ${pushToken ? pushToken.substring(0, 50) + '...' : 'NULL'}`);

    if (!pushToken) {
      console.error(`[Token Registration] ERROR: No push token provided for user ${userId}`);
      return res.status(400).json({ 
        success: false, 
        message: 'Push token is required' 
      });
    }

    // Validate Expo push token format (starts with ExponentPushToken or ExpoPushToken)
    const isValidFormat = pushToken.startsWith('ExponentPushToken[') || pushToken.startsWith('ExpoPushToken[');
    console.log(`[Token Registration] Token format valid: ${isValidFormat}`);
    
    if (!isValidFormat) {
      console.error(`[Token Registration] ERROR: Invalid token format for user ${userId}`);
      console.error(`[Token Registration] Token starts with: ${pushToken.substring(0, 30)}`);
      return res.status(400).json({ 
        success: false, 
        message: `Invalid push token format. Expected ExponentPushToken[...] or ExpoPushToken[...], got: ${pushToken.substring(0, 30)}...` 
      });
    }

    // Update user's push token
    console.log(`[Token Registration] Updating user ${userId} with push token...`);
    const user = await User.findByIdAndUpdate(
      userId,
      { pushToken: pushToken },
      { new: true }
    ).select('-password');

    if (!user) {
      console.error(`[Token Registration] ERROR: User ${userId} not found`);
      return res.status(404).json({ 
        success: false, 
        message: 'User not found' 
      });
    }

    console.log(`[Token Registration] SUCCESS: Token registered for user ${userId} (${user.name})`);
    console.log(`[Token Registration] User has pushToken: ${!!user.pushToken}`);

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
    console.error(`[Token Registration] ERROR: Exception occurred for user ${req.user?.id}:`, err);
    console.error(`[Token Registration] Error stack:`, err.stack);
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
