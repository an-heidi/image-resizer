const express = require('express');
const fileUpload = require('express-fileupload');
const sharp = require('sharp'); // Pure JavaScript image processing library

const app = express();
const port = 3000;

// Enable express-fileupload middleware
app.use(fileUpload());

// Helper function to resize and store images in buffers
const processImage = async (fileBuffer, quality) => {
    let image = sharp(fileBuffer);
    const originalSizeKB = fileBuffer.length / 1024;

    if (quality === 'low') {
        let targetQuality = Math.max(5, Math.min(30, Math.floor(50 / originalSizeKB * 100)));

        let processedImage = image;
        if (originalSizeKB > 1024) {
            processedImage = image.resize({
                width: 800,
                fit: 'inside',
                withoutEnlargement: true
            });
        }

        // Apply smoothing to reduce pixelation
        // processedImage = processedImage
        //     .blur(1) // Slight Gaussian blur to smooth edges
        //     .median(3); // Noise reduction to clean up artifacts

        processedImage = processedImage.jpeg({
            quality: targetQuality,
            progressive: true,
            optimizeScans: true,
            chromaSubsampling: '4:2:0',
            mozjpeg: true
        });

        // try {
        //     processedImage = processedImage
        //         .blur(5) // Slight Gaussian blur to smooth edges
        //         .median(5); // Noise reduction to clean up artifacts
        // } catch (error) {
        //     console.error('Error applying blur and median filter:', error);
        //     // Handle the error as needed
        // }
        return processedImage.toBuffer();
    }

    if (quality === 'medium') {
        const targetQuality = Math.min(90, Math.max(30, Math.floor(60 / originalSizeKB * 100)));
        return image.jpeg({
            quality: targetQuality,
            progressive: true,
            optimizeScans: true
        }).toBuffer();
    }

    return image.toBuffer();
};

// Upload route for handling file uploads
app.post('/upload', async (req, res) => {
    const { files } = req;

    // Check if files exist in the request
    if (!files || !files.media) {
        return res.status(400).send('No files were uploaded.');
    }

    const mediaFiles = Array.isArray(files.media) ? files.media : [files.media];
    const processedImages = {
        low: [],
        medium: [],
        original: [],
    };

    for (const file of mediaFiles) {
        try {
            const fileBuffer = file.data;

            // Process low quality image
            const lowQualityBuffer = await processImage(fileBuffer, 'low');
            processedImages.low.push({ name: `low_${file.name}`, buffer: lowQualityBuffer });

            // Process medium quality image
            const mediumQualityBuffer = await processImage(fileBuffer, 'medium');
            processedImages.medium.push({ name: `medium_${file.name}`, buffer: mediumQualityBuffer });

            // Process original image
            const originalQualityBuffer = await processImage(fileBuffer, 'original');
            processedImages.original.push({ name: `original_${file.name}`, buffer: originalQualityBuffer });

        } catch (error) {
            return res.status(500).send(`Error processing file: ${file.name}`);
        }
    }

    await saveProcessedImages(processedImages); // Save processed images to disk (optional)

    // Send response with processed images in memory (buffers)
    return res.json({
        message: 'Files uploaded and processed successfully'
    });
});

// To handle later saving (example function)
const saveImageToDisk = async (buffer, filePath) => {
    const fs = require('fs').promises;
    await fs.mkdir(filePath.substring(0, filePath.lastIndexOf('/')), { recursive: true });
    await fs.writeFile(filePath, buffer);
};

// Later saving (example route)
async function saveProcessedImages(processedImages) {
    try {
        // Loop through processed images and save them to disk (or another location)
        const { low, medium, original } = processedImages; // Assuming you send the processed data

        for (const file of low) {
            await saveImageToDisk(file.buffer, `output/low/${file.name}`);
        }
        for (const file of medium) {
            await saveImageToDisk(file.buffer, `output/medium/${file.name}`);
        }
        for (const file of original) {
            await saveImageToDisk(file.buffer, `output/original/${file.name}`);
        }
    } catch (error) {
        console.error('Error saving processed images:', error);
    }

}

app.listen(port, () => {
    console.log(`Server is running at http://localhost:${port}`);
});
