import multer from 'multer';

// Multer memory storage (uploads files to memory buffer)
const storage = multer.memoryStorage();
const upload = multer({ 
  storage: storage,
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB max file size
    files: 50 // Max 50 files
  }
});

export { upload };