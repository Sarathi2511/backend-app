const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const http = require('http');
const User = require('./models/User');
require('dotenv').config();

const app = express();
const server = http.createServer(app);

// Middleware
app.use(cors({
  origin: '*', // For debugging. You can restrict this later.
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

app.use(express.json());

// Connect to MongoDB
mongoose.connect(process.env.MONGODB_URI)
  .then(() => {
    console.log('Connected to MongoDB');
    // Initialize Super Admin after database connection
    initializeSuperAdmin();
  })
  .catch(err => console.error('Could not connect to MongoDB', err));

// Function to initialize Super Admin
const initializeSuperAdmin = async () => {
  try {
    // Check if Super Admin already exists
    const existingSuperAdmin = await User.findOne({ phone: '8087779333' });
    
    if (existingSuperAdmin) {
      // Update existing Super Admin to ensure correct credentials
      await User.findOneAndUpdate(
        { phone: '8087779333' },
        {
          name: 'Super Admin',
          phone: '8087779333',
          password: 'shubham18',
          role: 'Super Admin'
        }
      );
      console.log('Super Admin verified and updated');
    } else {
      // Create new Super Admin
      const superAdmin = new User({
        name: 'Super Admin',
        phone: '8087779333',
        password: 'shubham18',
        role: 'Super Admin'
      });
      await superAdmin.save();
      console.log('Super Admin created successfully');
    }
  } catch (error) {
    console.error('Error initializing Super Admin:', error);
  }
};

// JWT Secret
if (!process.env.JWT_SECRET) {
  console.error('FATAL ERROR: JWT_SECRET is not defined.');
  process.exit(1);
}

// Routes
const loginRouter = require('./routes/login');
const ordersRouter = require('./routes/orders');
const productsRouter = require('./routes/products');
const staffRouter = require('./routes/staff');
const customersRouter = require('./routes/customers');

app.use('/api/login', loginRouter);
app.use('/api/orders', ordersRouter);
app.use('/api/products', productsRouter);
app.use('/api/staff', staffRouter);
app.use('/api/customers', customersRouter);

// Initialize Socket.IO
const { initializeSocket } = require('./socket');
initializeSocket(server);

// Test endpoint to verify server is running
app.get('/api/test', (req, res) => {
  res.json({ message: 'Server is running', timestamp: new Date().toISOString() });
});

const port = process.env.PORT || 5000;
server.listen(port, () => console.log(`Server running on port ${port}`)); 