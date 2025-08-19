const mongoose = require('mongoose');

const productSchema = new mongoose.Schema({
  name: { type: String, required: true },
  brandName: { type: String, required: true },
  stockQuantity: { type: Number, required: true },
  dimension: { type: String, required: true },
  lowStockThreshold: { type: Number, required: true },
});

const Product = mongoose.model('Product', productSchema);

module.exports = Product; 