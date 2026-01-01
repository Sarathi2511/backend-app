const mongoose = require('mongoose');

const orderItemSchema = new mongoose.Schema({
  productId: { type: mongoose.Schema.Types.ObjectId, ref: 'Product', required: true },
  name: { type: String, required: true },
  brandName: { type: String },
  dimension: { type: String },
  qty: { type: Number, required: true },
  price: { type: Number, required: true },
  total: { type: Number, required: true },
}, { _id: false });

const orderSchema = new mongoose.Schema({
  orderId: { type: String, required: true, unique: true },
  date: { type: Date, required: true },
  status: { type: String, enum: ['active', 'completed'], default: 'active' }, // New status field
  customerName: { type: String, required: true },
  orderRoute: { type: String, required: true }, // New field for order route
  orderStatus: { type: String, required: true, enum: ['Pending', 'DC', 'Invoice', 'Dispatched'] },
  paymentCondition: { type: String, required: true },
  assignedTo: { type: String, required: true },
  assignedToId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  createdBy: { type: String, required: true },
  customerPhone: { type: String, required: true },
  customerAddress: { type: String, required: true },
  orderItems: { type: [orderItemSchema], default: [] },
  deliveryPartner: { type: String, default: null }, // Staff name assigned as delivery partner
  paymentMarkedBy: { type: String, default: null }, // Staff name who marked payment
  paymentRecievedBy: { type: String, default: null }, // Staff name who received payment
  statusUpdatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }, // User ID who last updated the status
  statusUpdatedAt: { type: Date }, // When the status was last updated
  statusHistory: [{
    status: { type: String, required: true },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    updatedAt: { type: Date, default: Date.now },
  }],
  isWithout: { type: Boolean, default: false }, // Special flag for orders assigned to Gaurav Miniyar
  additionalNotes: { type: String, default: '' }, // Additional notes for the order
});

// Middleware to update status history
orderSchema.pre('save', function(next) {
  if (this.isModified('orderStatus')) {
    if (!this.statusHistory) {
      this.statusHistory = [];
    }
    this.statusHistory.push({
      status: this.orderStatus,
      updatedBy: this.statusUpdatedBy,
      updatedAt: this.statusUpdatedAt || new Date(),
    });
  }
  next();
});

const Order = mongoose.model('Order', orderSchema);

module.exports = Order; 