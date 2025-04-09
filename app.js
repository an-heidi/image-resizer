const express = require('express');
const fileUpload = require('express-fileupload');
const sharp = require('sharp'); // Pure JavaScript image processing library
const { performance } = require('perf_hooks'); // For timing measurements

const app = express();
const port = 3000;

// Enable express-fileupload middleware
app.use(fileUpload());

// Helper function to resize and store images in buffers
const processImage = async (fileBuffer, quality) => {
    const startTime = performance.now();
    let image = sharp(fileBuffer);
    const originalSizeKB = fileBuffer.length / 1024;
    let result;

    if (quality === 'low') {
        let targetQuality = Math.max(10, Math.min(30, Math.floor(50 / originalSizeKB * 100)));

        let processedImage = image;
        if (originalSizeKB > 1024) {
            processedImage = image.resize({
                width: 1000,
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
        result = await processedImage.toBuffer();
    }

    if (quality === 'medium') {
        const targetQuality = Math.min(10, Math.max(30, Math.floor(60 / originalSizeKB * 100)));
        result = await image.jpeg({
            quality: targetQuality,
            progressive: true,
            optimizeScans: true
        }).toBuffer();
    }

    if (quality === 'original') {
        result = await image.toBuffer();
    }
    
    const endTime = performance.now();
    const processTime = endTime - startTime;
    const resultSizeKB = result.length / 1024;
    const compressionRatio = originalSizeKB / resultSizeKB;
    
    console.log(`Processing ${quality} quality: ${processTime.toFixed(2)}ms | Original: ${originalSizeKB.toFixed(2)}KB | Result: ${resultSizeKB.toFixed(2)}KB | Ratio: ${compressionRatio.toFixed(2)}x`);
    
    return { 
        buffer: result, 
        processTime,
        originalSize: originalSizeKB,
        resultSize: resultSizeKB,
        compressionRatio
    };
};

// Upload route for handling file uploads
app.post('/upload', async (req, res) => {
    const totalStartTime = performance.now();
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
    
    const timings = {
        totalProcessingTime: 0,
        files: []
    };
    
    const sizes = {
        totalOriginalSize: 0,
        totalProcessedSize: {
            low: 0,
            medium: 0,
            original: 0
        }
    };

    for (const file of mediaFiles) {
        try {
            const fileStartTime = performance.now();
            const fileTimings = { fileName: file.name, qualities: {} };
            const fileSizes = { fileName: file.name, qualities: {} };
            const fileBuffer = file.data;
            
            // Track original file size
            const originalFileSize = fileBuffer.length / 1024;
            sizes.totalOriginalSize += originalFileSize;

            // Process low quality image
            const { buffer: lowQualityBuffer, processTime: lowTime, resultSize: lowSize, compressionRatio: lowRatio } = 
                await processImage(fileBuffer, 'low');
            processedImages.low.push({ name: `low_${file.name}`, buffer: lowQualityBuffer });
            fileTimings.qualities.low = lowTime;
            fileSizes.qualities.low = { size: lowSize, ratio: lowRatio };
            sizes.totalProcessedSize.low += lowSize;

            // Process medium quality image
            const { buffer: mediumQualityBuffer, processTime: mediumTime, resultSize: mediumSize, compressionRatio: mediumRatio } = 
                await processImage(fileBuffer, 'medium');
            processedImages.medium.push({ name: `medium_${file.name}`, buffer: mediumQualityBuffer });
            fileTimings.qualities.medium = mediumTime;
            fileSizes.qualities.medium = { size: mediumSize, ratio: mediumRatio };
            sizes.totalProcessedSize.medium += mediumSize;

            // Process original quality image
            const { buffer: originalQualityBuffer, processTime: originalTime, resultSize: originalSize, compressionRatio: originalRatio } = 
                await processImage(fileBuffer, 'original');
            processedImages.original.push({ name: `original_${file.name}`, buffer: originalQualityBuffer });
            fileTimings.qualities.original = originalTime;
            fileSizes.qualities.original = { size: originalSize, ratio: originalRatio };
            sizes.totalProcessedSize.original += originalSize;

            const fileEndTime = performance.now();
            fileTimings.totalTime = fileEndTime - fileStartTime;
            timings.files.push(fileTimings);
            
            // Add file sizes info to tracking
            sizes.files = sizes.files || [];
            sizes.files.push(fileSizes);

        } catch (error) {
            return res.status(500).send(`Error processing file: ${file.name}`);
        }
    }

    const saveStartTime = performance.now();
    await saveProcessedImages(processedImages); // Save processed images to disk (optional)
    const saveEndTime = performance.now();
    
    const totalEndTime = performance.now();
    timings.totalProcessingTime = totalEndTime - totalStartTime;
    
    // Log total size information
    console.log('====== SIZE SUMMARY ======');
    console.log(`Total original size: ${sizes.totalOriginalSize.toFixed(2)}KB`);
    console.log(`Total low quality size: ${sizes.totalProcessedSize.low.toFixed(2)}KB (${(sizes.totalOriginalSize/sizes.totalProcessedSize.low).toFixed(2)}x smaller)`);
    console.log(`Total medium quality size: ${sizes.totalProcessedSize.medium.toFixed(2)}KB (${(sizes.totalOriginalSize/sizes.totalProcessedSize.medium).toFixed(2)}x smaller)`);
    console.log(`Total original quality size: ${sizes.totalProcessedSize.original.toFixed(2)}KB (${(sizes.totalOriginalSize/sizes.totalProcessedSize.original).toFixed(2)}x smaller)`);

    // Send response with processed images in memory (buffers) and timing information
    return res.json({
        message: 'Files uploaded and processed successfully',
        timings,
        sizes
    });
});

// To handle later saving (example function)
const saveImageToDisk = async (buffer, filePath) => {
    const startTime = performance.now();
    const fs = require('fs').promises;
    await fs.mkdir(filePath.substring(0, filePath.lastIndexOf('/')), { recursive: true });
    await fs.writeFile(filePath, buffer);
    const endTime = performance.now();
    return endTime - startTime;
};

// Later saving (example route)
async function saveProcessedImages(processedImages) {
    try {
        const savingTimes = {
            low: 0,
            medium: 0,
            original: 0
        };
        
        // Loop through processed images and save them to disk (or another location)
        const { low, medium, original } = processedImages; // Assuming you send the processed data

        for (const file of low) {
            const time = await saveImageToDisk(file.buffer, `output/low/${file.name}`);
            savingTimes.low += time;
        }
        for (const file of medium) {
            const time = await saveImageToDisk(file.buffer, `output/medium/${file.name}`);
            savingTimes.medium += time;
        }
        for (const file of original) {
            const time = await saveImageToDisk(file.buffer, `output/original/${file.name}`);
            savingTimes.original += time;
        }
        
        console.log(`Saving times (ms): Low: ${savingTimes.low.toFixed(2)}, Medium: ${savingTimes.medium.toFixed(2)}, Original: ${savingTimes.original.toFixed(2)}`);
    } catch (error) {
        console.error('Error saving processed images:', error);
    }
}

app.listen(port, () => {
    console.log(`Server is running at http://localhost:${port}`);
});
