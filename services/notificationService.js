const { getMessaging } = require('../config/firebase');
const User = require('../models/User');

/**
 * Get recipients based on notification type and role
 * @param {string} notificationType - Type of notification
 * @param {Object} context - Context data (order, product, etc.)
 * @returns {Promise<Array>} Array of user IDs to notify
 */
async function getRecipients(notificationType, context = {}) {
  const recipients = [];

  try {
    switch (notificationType) {
      // Order notifications
      case 'order_assigned_to_me':
        // Notify the assigned user
        if (context.assignedToId) {
          recipients.push(context.assignedToId);
        }
        break;

      case 'order_created':
        // Notify Admin, Staff, and Inventory Manager
        const orderCreatedUsers = await User.find({
          role: { $in: ['Admin', 'Staff', 'Inventory Manager'] },
          pushToken: { $ne: null },
        }).select('_id');
        recipients.push(...orderCreatedUsers.map(u => u._id));
        break;

      case 'order_status_updated':
      case 'order_status_pending_to_dc':
      case 'order_status_dc_to_invoice':
      case 'order_status_invoice_to_dispatched':
        // Notify assigned user, Admin, and Staff
        if (context.assignedToId) {
          recipients.push(context.assignedToId);
        }
        const statusUpdateUsers = await User.find({
          role: { $in: ['Admin', 'Staff'] },
          _id: { $ne: context.assignedToId }, // Don't duplicate assigned user
          pushToken: { $ne: null },
        }).select('_id');
        recipients.push(...statusUpdateUsers.map(u => u._id));
        break;

      case 'order_reassigned':
        // Notify new assignee, previous assignee, and Admin
        if (context.newAssignedToId) {
          recipients.push(context.newAssignedToId);
        }
        if (context.previousAssignedToId) {
          recipients.push(context.previousAssignedToId);
        }
        const adminUsers = await User.find({
          role: 'Admin',
          _id: { $nin: [context.newAssignedToId, context.previousAssignedToId].filter(Boolean) },
          pushToken: { $ne: null },
        }).select('_id');
        recipients.push(...adminUsers.map(u => u._id));
        break;

      case 'order_deleted':
        // Notify assigned user, creator, and Admin
        if (context.assignedToId) {
          recipients.push(context.assignedToId);
        }
        if (context.createdById) {
          recipients.push(context.createdById);
        }
        const deleteAdminUsers = await User.find({
          role: 'Admin',
          _id: { $nin: [context.assignedToId, context.createdById].filter(Boolean) },
          pushToken: { $ne: null },
        }).select('_id');
        recipients.push(...deleteAdminUsers.map(u => u._id));
        break;

      // Product/Inventory notifications
      case 'product_low_stock':
      case 'product_out_of_stock':
        // Notify Admin and Inventory Manager
        const inventoryNotificationUsers = await User.find({
          role: { $in: ['Admin', 'Inventory Manager'] },
          pushToken: { $ne: null },
        }).select('_id');
        recipients.push(...inventoryNotificationUsers.map(u => u._id));
        break;

      case 'product_created':
      case 'product_updated':
      case 'product_deleted':
        // Notify Admin and Inventory Manager only
        const productUsers = await User.find({
          role: { $in: ['Admin', 'Inventory Manager'] },
          pushToken: { $ne: null },
        }).select('_id');
        recipients.push(...productUsers.map(u => u._id));
        break;

      // Staff notifications
      case 'staff_created':
      case 'staff_updated':
      case 'staff_deleted':
        // Notify Admin only
        const staffUsers = await User.find({
          role: 'Admin',
          pushToken: { $ne: null },
        }).select('_id');
        recipients.push(...staffUsers.map(u => u._id));
        break;

      default:
        console.warn(`Unknown notification type: ${notificationType}`);
    }

    // Remove duplicates
    return [...new Set(recipients.map(id => id.toString()))];
  } catch (error) {
    console.error('Error getting recipients:', error);
    return [];
  }
}

/**
 * Format notification payload for FCM
 * @param {string} notificationType - Type of notification
 * @param {Object} data - Notification data
 * @returns {Object} Formatted FCM notification payload
 */
function formatNotificationPayload(notificationType, data) {
  const baseData = {
    type: notificationType,
    timestamp: String(Date.now()),
  };

  switch (notificationType) {
    case 'order_assigned_to_me':
      return {
        notification: {
          title: 'New Order Assigned',
          body: `Order ${data.orderId} (${data.customerName}) has been assigned to you`,
        },
        data: {
          ...baseData,
          orderId: String(data.orderId || ''),
          deepLink: '/orders/my-orders',
        },
        android: {
          priority: 'high',
          notification: {
            channelId: 'default',
            sound: 'default',
          },
        },
      };

    case 'order_created':
      return {
        notification: {
          title: 'Order Created',
          body: `Order ${data.orderId} (${data.customerName}) was created by ${data.createdBy}`,
        },
        data: {
          ...baseData,
          orderId: String(data.orderId || ''),
          deepLink: '/orders',
        },
        android: {
          notification: {
            channelId: 'default',
            sound: 'default',
          },
        },
      };

    case 'order_status_pending_to_dc':
      return {
        notification: {
          title: 'Order Status Updated',
          body: `Order ${data.orderId} moved to DC status`,
        },
        data: {
          ...baseData,
          orderId: String(data.orderId || ''),
          deepLink: data.assignedToId ? '/orders/my-orders' : '/orders',
        },
        android: {
          priority: 'high',
          notification: {
            channelId: 'default',
            sound: 'default',
          },
        },
      };

    case 'order_status_dc_to_invoice':
      return {
        notification: {
          title: 'Order Ready for Dispatch',
          body: `Order ${data.orderId} is ready for dispatch`,
        },
        data: {
          ...baseData,
          orderId: String(data.orderId || ''),
          deepLink: '/orders',
        },
        android: {
          priority: 'high',
          notification: {
            channelId: 'default',
            sound: 'default',
          },
        },
      };

    case 'order_status_invoice_to_dispatched':
      return {
        notification: {
          title: 'Order Dispatched',
          body: `Order ${data.orderId} has been dispatched via ${data.deliveryPartner || 'delivery partner'}`,
        },
        data: {
          ...baseData,
          orderId: String(data.orderId || ''),
          deepLink: data.assignedToId ? '/orders/my-orders' : '/orders',
        },
        android: {
          priority: 'high',
          notification: {
            channelId: 'default',
            sound: 'default',
          },
        },
      };

    case 'order_status_updated':
      return {
        notification: {
          title: 'Order Status Updated',
          body: `Order ${data.orderId} status changed to ${data.newStatus}`,
        },
        data: {
          ...baseData,
          orderId: String(data.orderId || ''),
          deepLink: data.assignedToId ? '/orders/my-orders' : '/orders',
        },
        android: {
          notification: {
            channelId: 'default',
            sound: 'default',
          },
        },
      };

    case 'order_reassigned':
      return {
        notification: {
          title: 'Order Reassigned',
          body: `Order ${data.orderId} has been reassigned to ${data.newAssignee}`,
        },
        data: {
          ...baseData,
          orderId: String(data.orderId || ''),
          deepLink: '/orders/my-orders',
        },
        android: {
          priority: 'high',
          notification: {
            channelId: 'default',
            sound: 'default',
          },
        },
      };

    case 'order_deleted':
      return {
        notification: {
          title: 'Order Deleted',
          body: `Order ${data.orderId} was deleted by ${data.deletedBy}`,
        },
        data: {
          ...baseData,
          orderId: String(data.orderId || ''),
          deepLink: '/orders',
        },
        android: {
          priority: 'high',
          notification: {
            channelId: 'default',
            sound: 'default',
          },
        },
      };

    case 'product_low_stock':
      return {
        notification: {
          title: 'Low Stock Alert',
          body: `${data.productName} is running low (Stock: ${data.stockQuantity}, Threshold: ${data.threshold})`,
        },
        data: {
          ...baseData,
          productId: String(data.productId || ''),
          deepLink: '/products',
        },
        android: {
          priority: 'high',
          notification: {
            channelId: 'default',
            sound: 'default',
          },
        },
      };

    case 'product_out_of_stock':
      return {
        notification: {
          title: 'Out of Stock',
          body: `${data.productName} is out of stock`,
        },
        data: {
          ...baseData,
          productId: String(data.productId || ''),
          deepLink: '/products',
        },
        android: {
          priority: 'high',
          notification: {
            channelId: 'default',
            sound: 'default',
          },
        },
      };

    case 'product_created':
      return {
        notification: {
          title: 'Product Created',
          body: `${data.productName} was added by ${data.createdBy}`,
        },
        data: {
          ...baseData,
          productId: String(data.productId || ''),
          deepLink: '/products',
        },
        android: {
          notification: {
            channelId: 'default',
            sound: 'default',
          },
        },
      };

    case 'product_updated':
      return {
        notification: {
          title: 'Product Updated',
          body: `${data.productName} was updated by ${data.updatedBy}`,
        },
        data: {
          ...baseData,
          productId: String(data.productId || ''),
          deepLink: '/products',
        },
        android: {
          notification: {
            channelId: 'default',
            sound: 'default',
          },
        },
      };

    case 'product_deleted':
      return {
        notification: {
          title: 'Product Deleted',
          body: `${data.productName} was deleted by ${data.deletedBy}`,
        },
        data: {
          ...baseData,
          productId: String(data.productId || ''),
          deepLink: '/products',
        },
        android: {
          notification: {
            channelId: 'default',
            sound: 'default',
          },
        },
      };

    case 'staff_created':
      return {
        notification: {
          title: 'Staff Created',
          body: `${data.staffName} (${data.role}) was added`,
        },
        data: {
          ...baseData,
          staffId: String(data.staffId || ''),
          deepLink: '/staff',
        },
        android: {
          notification: {
            channelId: 'default',
            sound: 'default',
          },
        },
      };

    case 'staff_updated':
      return {
        notification: {
          title: 'Staff Updated',
          body: `${data.staffName} was updated`,
        },
        data: {
          ...baseData,
          staffId: String(data.staffId || ''),
          deepLink: '/staff',
        },
        android: {
          notification: {
            channelId: 'default',
            sound: 'default',
          },
        },
      };

    case 'staff_deleted':
      return {
        notification: {
          title: 'Staff Deleted',
          body: `${data.staffName} was removed`,
        },
        data: {
          ...baseData,
          staffId: String(data.staffId || ''),
          deepLink: '/staff',
        },
        android: {
          notification: {
            channelId: 'default',
            sound: 'default',
          },
        },
      };

    case 'test':
      return {
        notification: {
          title: data.title || 'Test Notification 🎉',
          body: data.body || 'This is a test notification from Sarathi.',
        },
        data: {
          ...baseData,
        },
        android: {
          priority: 'high',
          notification: {
            channelId: 'default',
            sound: 'default',
          },
        },
      };

    default:
      return {
        notification: {
          title: 'Notification',
          body: 'You have a new notification',
        },
        data: baseData,
        android: {
          notification: {
            channelId: 'default',
            sound: 'default',
          },
        },
      };
  }
}

/**
 * Send push notification to a single user via FCM
 * @param {string} userId - User ID
 * @param {Object} payload - FCM notification payload
 * @returns {Promise<boolean>} Success status
 */
async function sendToUser(userId, payload) {
  try {
    const user = await User.findById(userId);
    if (!user || !user.pushToken) {
      return false;
    }

    const messaging = getMessaging();
    
    // Build FCM message
    const message = {
      token: user.pushToken,
      ...payload,
    };

    try {
      const response = await messaging.send(message);
      console.log(`Notification sent to user ${userId}:`, response);
      return true;
    } catch (error) {
      console.error(`Error sending notification to user ${userId}:`, error.message);
      
      // If token is invalid, clear it from database
      if (
        error.code === 'messaging/invalid-registration-token' ||
        error.code === 'messaging/registration-token-not-registered'
      ) {
        console.log(`Clearing invalid token for user ${userId}`);
        await User.findByIdAndUpdate(userId, { pushToken: null });
      }
      
      return false;
    }
  } catch (error) {
    console.error(`Error sending notification to user ${userId}:`, error);
    return false;
  }
}

/**
 * Send push notification to multiple recipients
 * @param {string} notificationType - Type of notification
 * @param {Object} data - Notification data
 * @param {Object} context - Additional context for recipient determination
 * @returns {Promise<Object>} Result with success count and errors
 */
async function sendNotification(notificationType, data, context = {}) {
  try {
    // Get recipients
    const recipientIds = await getRecipients(notificationType, { ...data, ...context });
    
    if (recipientIds.length === 0) {
      console.log(`No recipients found for notification type: ${notificationType}`);
      return { success: 0, failed: 0, errors: [] };
    }

    // Format payload
    const payload = formatNotificationPayload(notificationType, data);

    // Send to all recipients
    const results = await Promise.allSettled(
      recipientIds.map(userId => sendToUser(userId, payload))
    );

    const success = results.filter(r => r.status === 'fulfilled' && r.value === true).length;
    const failed = results.filter(r => r.status === 'rejected' || r.value === false).length;
    const errors = results
      .filter(r => r.status === 'rejected')
      .map(r => r.reason?.message || 'Unknown error');

    console.log(`Notification ${notificationType} sent: ${success} success, ${failed} failed`);

    return { success, failed, errors };
  } catch (error) {
    console.error(`Error sending notification ${notificationType}:`, error);
    return { success: 0, failed: 0, errors: [error.message] };
  }
}

/**
 * Send notification with retry logic
 * @param {string} notificationType - Type of notification
 * @param {Object} data - Notification data
 * @param {Object} context - Additional context
 * @param {number} maxRetries - Maximum retry attempts (default: 2)
 * @returns {Promise<Object>} Result
 */
async function sendNotificationWithRetry(notificationType, data, context = {}, maxRetries = 2) {
  let lastError = null;
  
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const result = await sendNotification(notificationType, data, context);
      if (result.success > 0 || attempt === maxRetries) {
        return result;
      }
      // Wait before retry (exponential backoff)
      await new Promise(resolve => setTimeout(resolve, Math.pow(2, attempt) * 1000));
    } catch (error) {
      lastError = error;
      if (attempt < maxRetries) {
        await new Promise(resolve => setTimeout(resolve, Math.pow(2, attempt) * 1000));
      }
    }
  }

  return { success: 0, failed: 0, errors: [lastError?.message || 'Max retries exceeded'] };
}

module.exports = {
  sendNotification,
  sendNotificationWithRetry,
  sendToUser,
  getRecipients,
  formatNotificationPayload,
};
