const express = require('express');
const router = express.Router();
const Product = require('../models/Product');
const { verifyToken, isAdmin, canCreateProducts, canModifyProducts } = require('../middleware/auth');
const { emitProductCreated, emitProductUpdated, emitProductDeleted } = require('../socket/events');

// Get all products
router.get('/', verifyToken, async (req, res) => {
  try {
    const products = await Product.find();
    res.json(products);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Get distinct brand names for autocomplete
router.get('/brands', verifyToken, async (req, res) => {
  try {
    const brands = await Product.distinct('brandName');
    // Sort case-insensitively and filter out empty values
    const sorted = brands
      .filter(Boolean)
      .sort((a, b) => String(a).toLowerCase().localeCompare(String(b).toLowerCase()));
    res.json(sorted);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Create new product - Admin, Staff, and Executive can create
router.post('/', verifyToken, canCreateProducts, async (req, res) => {
  const product = new Product(req.body);
  try {
    const newProduct = await product.save();
    
    // Emit WebSocket event for product creation
    emitProductCreated(newProduct, {
      id: req.user.id,
      name: req.user.name,
      role: req.user.role
    });
    
    res.status(201).json(newProduct);
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});

// Update product - Admin and Staff only
router.put('/:id', verifyToken, canModifyProducts, async (req, res) => {
  try {
    const updatedProduct = await Product.findByIdAndUpdate(
      req.params.id,
      req.body,
      { new: true }
    );
    
    // Emit WebSocket event for product update
    emitProductUpdated(updatedProduct, {
      id: req.user.id,
      name: req.user.name,
      role: req.user.role
    });
    
    res.json(updatedProduct);
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});

// Delete product - Admin only
router.delete('/:id', verifyToken, isAdmin, async (req, res) => {
  try {
    // Get product details before deletion for WebSocket event
    const productToDelete = await Product.findById(req.params.id);
    
    await Product.findByIdAndDelete(req.params.id);
    
    // Emit WebSocket event for product deletion
    if (productToDelete) {
      emitProductDeleted(
        productToDelete._id,
        productToDelete.name,
        {
          id: req.user.id,
          name: req.user.name,
          role: req.user.role
        }
      );
    }
    
    res.json({ message: 'Product deleted successfully' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

module.exports = router; 