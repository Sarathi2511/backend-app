const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
  name: { type: String, required: true },
  phone: { type: String, required: true, unique: true },
  password: { type: String, required: true },
  role: { type: String, enum: ['Admin', 'Staff', 'Executive', 'Inventory Manager'], required: true },
  pushToken: { type: String, default: null }, // Expo push notification token
  notificationPreferences: {
    orderNotifications: { type: Boolean, default: true },
    inventoryNotifications: { type: Boolean, default: true },
    staffNotifications: { type: Boolean, default: true },
    systemNotifications: { type: Boolean, default: true },
  },
});

const User = mongoose.model('User', userSchema);

module.exports = User; 