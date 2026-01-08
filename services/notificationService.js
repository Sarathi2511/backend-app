const { Expo } = require('expo-server-sdk');
const User = require('../models/User');

// Create a new Expo SDK client
const expo = new Expo();

/**
 * Get recipients based on notification type and role
 * @param {string} notificationType - Type of notification
 * @param {Object} context - Context data (order, product, etc.)
 * @returns {Promise<Array>} Array of user IDs or user objects to notify
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

      case 'order_status_dc_to_invoice':
        // Also notify Inventory Manager for stock check
        const inventoryUsers = await User.find({
          role: 'Inventory Manager',
          pushToken: { $ne: null },
        }).select('_id');
        recipients.push(...inventoryUsers.map(u => u._id));
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
 * Format notification payload based on type
 * @param {string} notificationType - Type of notification
 * @param {Object} data - Notification data
 * @returns {Object} Formatted notification payload
 */
function formatNotificationPayload(notificationType, data) {
  const basePayload = {
    sound: 'default',
    priority: 'default',
    data: {
      type: notificationType,
      timestamp: Date.now(),
    },
  };

  switch (notificationType) {
    case 'order_assigned_to_me':
      return {
        ...basePayload,
        title: 'New Order Assigned',
        body: `Order ${data.orderId} (${data.customerName}) has been assigned to you`,
        priority: 'high',
        data: {
          ...basePayload.data,
          orderId: data.orderId,
          deepLink: '/orders/my-orders',
        },
      };

    case 'order_created':
      return {
        ...basePayload,
        title: 'Order Created',
        body: `Order ${data.orderId} (${data.customerName}) was created by ${data.createdBy}`,
        data: {
          ...basePayload.data,
          orderId: data.orderId,
          deepLink: '/orders',
        },
      };

    case 'order_status_pending_to_dc':
      return {
        ...basePayload,
        title: 'Order Status Updated',
        body: `Order ${data.orderId} moved to DC status`,
        priority: 'high',
        data: {
          ...basePayload.data,
          orderId: data.orderId,
          deepLink: data.assignedToId ? '/orders/my-orders' : '/orders',
        },
      };

    case 'order_status_dc_to_invoice':
      return {
        ...basePayload,
        title: 'Order Ready for Dispatch',
        body: `Order ${data.orderId} is ready for dispatch`,
        priority: 'high',
        data: {
          ...basePayload.data,
          orderId: data.orderId,
          deepLink: '/orders',
        },
      };

    case 'order_status_invoice_to_dispatched':
      return {
        ...basePayload,
        title: 'Order Dispatched',
        body: `Order ${data.orderId} has been dispatched via ${data.deliveryPartner || 'delivery partner'}`,
        priority: 'high',
        data: {
          ...basePayload.data,
          orderId: data.orderId,
          deepLink: data.assignedToId ? '/orders/my-orders' : '/orders',
        },
      };

    case 'order_status_updated':
      return {
        ...basePayload,
        title: 'Order Status Updated',
        body: `Order ${data.orderId} status changed to ${data.newStatus}`,
        data: {
          ...basePayload.data,
          orderId: data.orderId,
          deepLink: data.assignedToId ? '/orders/my-orders' : '/orders',
        },
      };

    case 'order_reassigned':
      return {
        ...basePayload,
        title: 'Order Reassigned',
        body: `Order ${data.orderId} has been reassigned to ${data.newAssignee}`,
        priority: 'high',
        data: {
          ...basePayload.data,
          orderId: data.orderId,
          deepLink: '/orders/my-orders',
        },
      };

    case 'order_deleted':
      return {
        ...basePayload,
        title: 'Order Deleted',
        body: `Order ${data.orderId} was deleted by ${data.deletedBy}`,
        priority: 'high',
        data: {
          ...basePayload.data,
          orderId: data.orderId,
          deepLink: '/orders',
        },
      };

    case 'product_low_stock':
      return {
        ...basePayload,
        title: 'Low Stock Alert',
        body: `${data.productName} is running low (Stock: ${data.stockQuantity}, Threshold: ${data.threshold})`,
        priority: 'high',
        data: {
          ...basePayload.data,
          productId: data.productId,
          deepLink: '/products',
        },
      };

    case 'product_out_of_stock':
      return {
        ...basePayload,
        title: 'Out of Stock',
        body: `${data.productName} is out of stock`,
        priority: 'high',
        data: {
          ...basePayload.data,
          productId: data.productId,
          deepLink: '/products',
        },
      };

    case 'product_created':
      return {
        ...basePayload,
        title: 'Product Created',
        body: `${data.productName} was added by ${data.createdBy}`,
        data: {
          ...basePayload.data,
          productId: data.productId,
          deepLink: '/products',
        },
      };

    case 'product_updated':
      return {
        ...basePayload,
        title: 'Product Updated',
        body: `${data.productName} was updated by ${data.updatedBy}`,
        data: {
          ...basePayload.data,
          productId: data.productId,
          deepLink: '/products',
        },
      };

    case 'product_deleted':
      return {
        ...basePayload,
        title: 'Product Deleted',
        body: `${data.productName} was deleted by ${data.deletedBy}`,
        data: {
          ...basePayload.data,
          productId: data.productId,
          deepLink: '/products',
        },
      };

    case 'staff_created':
      return {
        ...basePayload,
        title: 'Staff Created',
        body: `${data.staffName} (${data.role}) was added`,
        data: {
          ...basePayload.data,
          staffId: data.staffId,
          deepLink: '/staff',
        },
      };

    case 'staff_updated':
      return {
        ...basePayload,
        title: 'Staff Updated',
        body: `${data.staffName} was updated`,
        data: {
          ...basePayload.data,
          staffId: data.staffId,
          deepLink: '/staff',
        },
      };

    case 'staff_deleted':
      return {
        ...basePayload,
        title: 'Staff Deleted',
        body: `${data.staffName} was removed`,
        data: {
          ...basePayload.data,
          staffId: data.staffId,
          deepLink: '/staff',
        },
      };

    default:
      return {
        ...basePayload,
        title: 'Notification',
        body: 'You have a new notification',
      };
  }
}

/**
 * Send push notification to a single user
 * @param {string} userId - User ID
 * @param {Object} payload - Notification payload
 * @returns {Promise<boolean>} Success status
 */
async function sendToUser(userId, payload) {
  try {
    const user = await User.findById(userId);
    if (!user || !user.pushToken) {
      return false;
    }

    // Check if token is valid Expo token
    if (!Expo.isExpoPushToken(user.pushToken)) {
      console.warn(`Invalid Expo push token for user ${userId}`);
      // Optionally clear invalid token
      await User.findByIdAndUpdate(userId, { pushToken: null });
      return false;
    }

    const messages = [{
      to: user.pushToken,
      ...payload,
    }];

    const chunks = expo.chunkPushNotifications(messages);
    const tickets = [];

    for (const chunk of chunks) {
      try {
        const ticketChunk = await expo.sendPushNotificationsAsync(chunk);
        tickets.push(...ticketChunk);
      } catch (error) {
        console.error('Error sending push notifications chunk:', error);
      }
    }

    // Check for errors in tickets
    for (let i = 0; i < tickets.length; i++) {
      const ticket = tickets[i];
      if (ticket.status === 'error') {
        console.error(`Error sending notification to user ${userId}:`, ticket.message);
        // If token is invalid, clear it
        if (ticket.details && ticket.details.error === 'DeviceNotRegistered') {
          await User.findByIdAndUpdate(userId, { pushToken: null });
        }
        return false;
      }
    }

    return true;
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

