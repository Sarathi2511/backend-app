const jwt = require('jsonwebtoken');
const User = require('../models/User');

// Middleware to verify JWT token
const verifyToken = (req, res, next) => {
  const token = req.header('Authorization')?.replace('Bearer ', '');
  
  if (!token) {
    return res.status(401).json({ success: false, message: 'Access denied. No token provided.' });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = decoded;
    next();
  } catch (err) {
    res.status(401).json({ success: false, message: 'Invalid token.' });
  }
};

// Middleware to check if user is admin
const isAdmin = async (req, res, next) => {
  try {
    const user = await User.findById(req.user.id);
    
    if (!user || user.role !== 'Admin') {
      return res.status(403).json({ success: false, message: 'Access denied. Admin rights required.' });
    }
    
    next();
  } catch (err) {
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

// Middleware to check if user is Staff or Admin
const isStaffOrAdmin = async (req, res, next) => {
  try {
    const user = await User.findById(req.user.id);
    
    if (!user || !['Admin', 'Staff'].includes(user.role)) {
      return res.status(403).json({ success: false, message: 'Access denied. Staff or Admin rights required.' });
    }
    
    next();
  } catch (err) {
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

// Middleware to check if user can create orders (Admin, Staff, or Executive)
const canCreateOrders = async (req, res, next) => {
  try {
    const user = await User.findById(req.user.id);
    
    if (!user || !['Admin', 'Staff', 'Executive'].includes(user.role)) {
      return res.status(403).json({ success: false, message: 'Access denied. Insufficient permissions.' });
    }
    
    next();
  } catch (err) {
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

// Middleware to check if user can modify orders (Admin or Staff only)
const canModifyOrders = async (req, res, next) => {
  try {
    const user = await User.findById(req.user.id);
    
    if (!user || !['Admin', 'Staff'].includes(user.role)) {
      return res.status(403).json({ success: false, message: 'Access denied. Cannot modify orders with current role.' });
    }
    
    next();
  } catch (err) {
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

// Middleware to check if user can create products (Admin, Staff, Executive, or Inventory Manager)
const canCreateProducts = async (req, res, next) => {
  try {
    const user = await User.findById(req.user.id);
    
    if (!user || !['Admin', 'Staff', 'Executive', 'Inventory Manager'].includes(user.role)) {
      return res.status(403).json({ success: false, message: 'Access denied. Cannot create products with current role.' });
    }
    
    next();
  } catch (err) {
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

// Middleware to check if user can modify products (Admin, Staff, or Inventory Manager)
const canModifyProducts = async (req, res, next) => {
  try {
    const user = await User.findById(req.user.id);
    
    if (!user || !['Admin', 'Staff', 'Inventory Manager'].includes(user.role)) {
      return res.status(403).json({ success: false, message: 'Access denied. Cannot modify products with current role.' });
    }
    
    next();
  } catch (err) {
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

module.exports = {
  verifyToken,
  isAdmin,
  isStaffOrAdmin,
  canCreateOrders,
  canModifyOrders,
  canCreateProducts,
  canModifyProducts
}; 