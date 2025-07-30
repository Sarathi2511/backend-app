const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const http = require('http');
require('dotenv').config();

const app = express();
const server = http.createServer(app);

// Middleware
app.use(cors());
app.use(express.json());

// Connect to MongoDB
mongoose.connect(process.env.MONGODB_URI)
  .then(() => console.log('Connected to MongoDB'))
  .catch(err => console.error('Could not connect to MongoDB', err));

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

app.use('/api/login', loginRouter);
app.use('/api/orders', ordersRouter);
app.use('/api/products', productsRouter);
app.use('/api/staff', staffRouter);

// Initialize Socket.IO
const { initializeSocket } = require('./socket');
initializeSocket(server);

// Test endpoint to verify server is running
app.get('/api/test', (req, res) => {
  res.json({ message: 'Server is running', timestamp: new Date().toISOString() });
});

const port = process.env.PORT || 5000;
server.listen(port, () => console.log(`Server running on port ${port}`)); 