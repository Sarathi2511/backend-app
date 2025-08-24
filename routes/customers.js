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

// Get customer details by name
router.get('/by-name/:name', verifyToken, async (req, res) => {
  try {
    const customer = await Customer.findOne({ name: req.params.name }, 'name phone address');
    if (!customer) {
      return res.status(404).json({ message: 'Customer not found' });
    }
    res.json(customer);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

module.exports = router;


