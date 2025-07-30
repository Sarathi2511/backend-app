const socketIO = require('socket.io');
const jwt = require('jsonwebtoken');
const User = require('../models/User');

let io;

const initializeSocket = (server) => {
  io = socketIO(server, {
    cors: {
      origin: "*",
      methods: ["GET", "POST"]
    }
  });

  // Authentication middleware
  io.use(async (socket, next) => {
    try {
      const token = socket.handshake.auth.token;
      
      if (!token) {
        return next(new Error('Authentication error: No token provided'));
      }

      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      const user = await User.findById(decoded.id);
      
      if (!user) {
        return next(new Error('Authentication error: User not found'));
      }

      socket.user = {
        id: user._id,
        name: user.name,
        role: user.role
      };
      
      next();
    } catch (error) {
      next(new Error('Authentication error: Invalid token'));
    }
  });

  // Connection handler
  io.on('connection', (socket) => {
    // Join role-based room
    socket.join(`role_${socket.user.role.toLowerCase()}`);
    
    // Join user-specific room
    socket.join(`user_${socket.user.id}`);

    // Emit user connected event to admins
    if (io) {
      io.to('role_admin').emit('user:connected', {
        user: {
          id: socket.user.id,
          name: socket.user.name,
          role: socket.user.role
        },
        timestamp: new Date()
      });
    }

    socket.on('disconnect', () => {
      // Emit user disconnected event to admins
      if (io) {
        io.to('role_admin').emit('user:disconnected', {
          user: {
            id: socket.user.id,
            name: socket.user.name,
            role: socket.user.role
          },
          timestamp: new Date()
        });
      }
    });
  });

  return io;
};

const getIO = () => {
  if (!io) {
    throw new Error('Socket.io not initialized');
  }
  return io;
};

module.exports = { initializeSocket, getIO }; 