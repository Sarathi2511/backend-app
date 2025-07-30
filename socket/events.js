const { getIO } = require('./index');

// Product events
const emitProductCreated = (product, createdBy) => {
  const io = getIO();
  
  // Emit to all connected users (Admin, Staff, Executive can all see products)
  io.emit('product:created', {
    product,
    createdBy: {
      id: createdBy.id,
      name: createdBy.name,
      role: createdBy.role
    },
    timestamp: new Date()
  });
};

const emitProductUpdated = (product, updatedBy) => {
  const io = getIO();
  
  // Emit to all connected users
  io.emit('product:updated', {
    product,
    updatedBy: {
      id: updatedBy.id,
      name: updatedBy.name,
      role: updatedBy.role
    },
    timestamp: new Date()
  });
};

const emitProductDeleted = (productId, productName, deletedBy) => {
  const io = getIO();
  
  // Emit to all connected users
  io.emit('product:deleted', {
    productId,
    productName,
    deletedBy: {
      id: deletedBy.id,
      name: deletedBy.name,
      role: deletedBy.role
    },
    timestamp: new Date()
  });
};

module.exports = {
  emitProductCreated,
  emitProductUpdated,
  emitProductDeleted
}; 