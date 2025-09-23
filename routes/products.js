const express = require('express');
const router = express.Router();
const Product = require('../models/Product');
const { verifyToken, isAdmin, canCreateProducts, canModifyProducts } = require('../middleware/auth');
const { emitProductCreated, emitProductUpdated, emitProductDeleted } = require('../socket/events');
const multer = require('multer');
const { parse } = require('csv-parse/sync');

// Configure multer to store files in memory
const upload = multer({ storage: multer.memoryStorage() });

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

// Update stock quantity - Admin, Staff, and Executive can update
router.patch('/:id/stock', verifyToken, canModifyProducts, async (req, res) => {
  try {
    const { stockToAdd } = req.body;
    
    // Validate input
    if (typeof stockToAdd !== 'number' || stockToAdd <= 0) {
      return res.status(400).json({ message: 'Stock to add must be a positive number' });
    }
    
    const product = await Product.findById(req.params.id);
    if (!product) {
      return res.status(404).json({ message: 'Product not found' });
    }
    
    // Update stock quantity
    const newStockQuantity = product.stockQuantity + stockToAdd;
    const updatedProduct = await Product.findByIdAndUpdate(
      req.params.id,
      { stockQuantity: newStockQuantity },
      { new: true }
    );
    
    // Emit WebSocket event for product update
    emitProductUpdated(updatedProduct, {
      id: req.user.id,
      name: req.user.name,
      role: req.user.role
    });
    
    res.json({
      message: 'Stock updated successfully',
      product: updatedProduct,
      stockAdded: stockToAdd,
      newStockQuantity: newStockQuantity
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
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

// CSV Import Route - Admin, Staff, and Executive can import (same as create)
router.post('/import', verifyToken, canCreateProducts, upload.single('file'), async (req, res) => {
  try {
    if (!req.file || !req.file.buffer) {
      return res.status(400).json({ message: 'CSV file is required' });
    }

    const csvString = req.file.buffer.toString('utf-8');

    // Parse CSV with headers
    let records;
    try {
      records = parse(csvString, {
        columns: true,
        skip_empty_lines: true,
        trim: true
      });
    } catch (e) {
      return res.status(400).json({ message: 'Failed to parse CSV', error: String(e.message || e) });
    }

    if (!Array.isArray(records) || records.length === 0) {
      return res.status(400).json({ message: 'CSV has no rows' });
    }

    const results = {
      totalRows: records.length,
      created: 0,
      updated: 0,
      errors: [],
      warnings: []
    };

    // Helper to normalize keys
    const normalizeKey = (k) => String(k || '').toLowerCase().replace(/\s+/g, '');

    for (let index = 0; index < records.length; index++) {
      const row = records[index];
      try {
        // Support a few alternate header spellings
        const keyed = {};
        for (const key of Object.keys(row)) {
          keyed[normalizeKey(key)] = row[key];
        }

        // Extract values with defaults for missing fields
        const originalName = (keyed['name'] ?? row.name ?? '').toString().trim();
        const originalBrandName = (keyed['brandname'] ?? keyed['brand'] ?? row.brandName ?? '').toString().trim();
        const originalDimension = (keyed['dimension'] ?? row.dimension ?? '').toString().trim();
        const originalStockQuantity = keyed['stockquantity'] ?? keyed['stock'] ?? row.stockQuantity;
        const originalLowStockThreshold = keyed['lowstockthreshold'] ?? keyed['threshold'] ?? row.lowStockThreshold;

        // Apply defaults and track warnings
        const name = originalName || `Product ${index + 1}`;
        const brandName = originalBrandName || 'Generic';
        const dimension = originalDimension || 'Standard';
        const stockQuantityRaw = originalStockQuantity ?? 0;
        const lowStockThresholdRaw = originalLowStockThreshold ?? 10;

        // Convert to numbers with fallbacks
        const stockQuantity = Number.isFinite(Number(stockQuantityRaw)) ? Number(stockQuantityRaw) : 0;
        const lowStockThreshold = Number.isFinite(Number(lowStockThresholdRaw)) ? Number(lowStockThresholdRaw) : 10;

        // Track warnings for missing fields
        const warnings = [];
        if (!originalName) warnings.push('name');
        if (!originalBrandName) warnings.push('brand');
        if (!originalDimension) warnings.push('dimension');
        if (originalStockQuantity === undefined || originalStockQuantity === '') warnings.push('stock');
        if (originalLowStockThreshold === undefined || originalLowStockThreshold === '') warnings.push('threshold');

        if (warnings.length > 0) {
          results.warnings.push({ 
            row: index + 1, 
            message: `Used defaults for: ${warnings.join(', ')}`,
            fields: warnings
          });
        }

        // Skip only if name is completely empty (this is the only truly required field)
        if (!name || name === '') {
          results.errors.push({ row: index + 1, message: 'Product name is required' });
          continue;
        }

        // Upsert by (name + brandName)
        const existing = await Product.findOne({ name, brandName });
        if (existing) {
          existing.dimension = dimension;
          existing.stockQuantity = stockQuantity;
          existing.lowStockThreshold = lowStockThreshold;
          const updated = await existing.save();
          results.updated += 1;
          emitProductUpdated(updated, {
            id: req.user.id,
            name: req.user.name,
            role: req.user.role
          });
        } else {
          const created = await Product.create({ name, brandName, dimension, stockQuantity, lowStockThreshold });
          results.created += 1;
          emitProductCreated(created, {
            id: req.user.id,
            name: req.user.name,
            role: req.user.role
          });
        }
      } catch (rowErr) {
        results.errors.push({ row: index + 1, message: String(rowErr.message || rowErr) });
      }
    }

    return res.json(results);
  } catch (err) {
    return res.status(500).json({ message: 'Unexpected error during import', error: String(err.message || err) });
  }
});

module.exports = router;