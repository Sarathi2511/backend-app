const express = require('express');
const router = express.Router();
const Customer = require('../models/Customer');
const { verifyToken } = require('../middleware/auth');

// Get all customers (basic fields)
router.get('/', verifyToken, async (req, res) => {
  try {
    const customers = await Customer.find({}, 'name phone address').sort({ name: 1 });
    res.json(customers);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

module.exports = router;


