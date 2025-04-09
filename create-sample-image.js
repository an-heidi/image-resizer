const sharp = require('sharp');
const fs = require('fs');
const path = require('path');

// Create a 1MB sample image that will be duplicated to reach the desired size
async function createSampleImage() {
  try {
    // Create a simple gradient image
    const width = 1000;
    const height = 1000;
    const channels = 3; // RGB
    
    // Create a gradient buffer
    const buffer = Buffer.alloc(width * height * channels);
    
    // Fill with a simple gradient pattern
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const i = (y * width + x) * channels;
        buffer[i] = Math.floor(255 * x / width);     // R
        buffer[i + 1] = Math.floor(255 * y / height); // G
        buffer[i + 2] = Math.floor(255 * (x + y) / (width + height)); // B
      }
    }
    
    // Create the image with sharp
    await sharp(buffer, {
      raw: {
        width,
        height,
        channels
      }
    })
    .jpeg({
      quality: 80
    })
    .toFile(path.join(__dirname, 'sample.jpg'));
    
    console.log('Sample image created successfully!');
    
    // Check file size
    const stats = fs.statSync(path.join(__dirname, 'sample.jpg'));
    console.log(`Sample image size: ${(stats.size / (1024 * 1024)).toFixed(2)} MB`);
  } catch (error) {
    console.error('Error creating sample image:', error);
  }
}

createSampleImage(); 