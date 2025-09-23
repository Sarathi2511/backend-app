const { getIO } = require('./index');

// Product events
const emitProductCreated = (product, createdBy) => {
  try {
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
  } catch (error) {
    console.error('Error emitting product:created event:', error.message);
  }
};

const emitProductUpdated = (product, updatedBy) => {
  try {
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
  } catch (error) {
    console.error('Error emitting product:updated event:', error.message);
  }
};

const emitProductDeleted = (productId, productName, deletedBy) => {
  try {
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
  } catch (error) {
    console.error('Error emitting product:deleted event:', error.message);
  }
};

// Staff events
const emitStaffCreated = (staff, createdBy) => {
  try {
    const io = getIO();
    
    // Emit to admin users only (staff management is admin-only)
    io.to('role_admin').emit('staff:created', {
      staff,
      createdBy: {
        id: createdBy.id,
        name: createdBy.name,
        role: createdBy.role
      },
      timestamp: new Date()
    });
  } catch (error) {
    console.error('Error emitting staff:created event:', error.message);
  }
};

const emitStaffUpdated = (staff, updatedBy) => {
  try {
    const io = getIO();
    
    // Emit to admin users only
    io.to('role_admin').emit('staff:updated', {
      staff,
      updatedBy: {
        id: updatedBy.id,
        name: updatedBy.name,
        role: updatedBy.role
      },
      timestamp: new Date()
    });
  } catch (error) {
    console.error('Error emitting staff:updated event:', error.message);
  }
};

const emitStaffDeleted = (staffId, staffName, deletedBy) => {
  try {
    const io = getIO();
    
    // Emit to admin users only
    io.to('role_admin').emit('staff:deleted', {
      staffId,
      staffName,
      deletedBy: {
        id: deletedBy.id,
        name: deletedBy.name,
        role: deletedBy.role
      },
      timestamp: new Date()
    });
  } catch (error) {
    console.error('Error emitting staff:deleted event:', error.message);
  }
};

// Order events
const emitOrderCreated = (order, createdBy) => {
  try {
    const io = getIO();
    
    // Emit to all connected users (Admin, Staff, Executive can all see orders)
    io.emit('order:created', {
      order,
      createdBy: {
        id: createdBy.id,
        name: createdBy.name,
        role: createdBy.role
      },
      timestamp: new Date()
    });
  } catch (error) {
    console.error('Error emitting order:created event:', error.message);
  }
};

const emitOrderUpdated = (order, updatedBy) => {
  try {
    const io = getIO();
    
    // Emit to all connected users
    io.emit('order:updated', {
      order,
      updatedBy: {
        id: updatedBy.id,
        name: updatedBy.name,
        role: updatedBy.role
      },
      timestamp: new Date()
    });
  } catch (error) {
    console.error('Error emitting order:updated event:', error.message);
  }
};

const emitOrderDeleted = (orderId, orderName, deletedBy) => {
  try {
    const io = getIO();
    
    // Emit to all connected users
    io.emit('order:deleted', {
      orderId,
      orderName,
      deletedBy: {
        id: deletedBy.id,
        name: deletedBy.name,
        role: deletedBy.role
      },
      timestamp: new Date()
    });
  } catch (error) {
    console.error('Error emitting order:deleted event:', error.message);
  }
};

module.exports = {
  emitProductCreated,
  emitProductUpdated,
  emitProductDeleted,
  emitStaffCreated,
  emitStaffUpdated,
  emitStaffDeleted,
  emitOrderCreated,
  emitOrderUpdated,
  emitOrderDeleted
}; 