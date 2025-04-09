const fs = require('fs');
const path = require('path');
const axios = require('axios');
const FormData = require('form-data');
const { performance } = require('perf_hooks');
const os = require('os');

const SERVER_URL = 'http://localhost:3000/upload';
const SAMPLE_IMAGE_PATH = path.join(__dirname, 'sample.png'); // You'll need a sample image
const TARGET_SIZE_MB = 20; // Target size for test images in MB

// Resource and safety settings
const SAFETY_LIMITS = {
  maxConcurrentRequests: 50,     // Maximum concurrent requests to run
  maxTotalRequestsPerRun: 100,   // Maximum total requests in a single benchmark
  maxMemoryThresholdPercent: 80, // Stop if memory exceeds this percentage of system memory
  maxMemoryThresholdMB: 4096,    // Stop if memory exceeds this amount in MB
  maxTimePerScenarioSec: 300,    // Maximum time allowed per scenario in seconds
  minDelayBetweenScenariosSec: 5 // Minimum delay between scenarios in seconds
};

// Resource monitoring class
class ResourceMonitor {
  constructor() {
    this.cpuUsage = process.cpuUsage();
    this.memUsage = process.memoryUsage();
    this.startTime = performance.now();
    this.samples = [];
    this.interval = null;
    this.sampleRate = 1000; // 1 sample per second
  }

  start() {
    this.cpuUsage = process.cpuUsage();
    this.memUsage = process.memoryUsage();
    this.startTime = performance.now();
    this.samples = [];
    
    // Sample CPU and memory usage regularly
    this.interval = setInterval(() => {
      this.sample();
    }, this.sampleRate);
  }

  sample() {
    const newCpuUsage = process.cpuUsage(this.cpuUsage);
    const newMemUsage = process.memoryUsage();
    const elapsedMs = performance.now() - this.startTime;
    
    // Calculate CPU usage as percentage across all cores
    const cpuUsagePercent = (newCpuUsage.user + newCpuUsage.system) / (elapsedMs * 1000) * 100 / os.cpus().length;
    
    this.samples.push({
      timestamp: elapsedMs,
      cpu: cpuUsagePercent,
      memory: {
        rss: newMemUsage.rss / (1024 * 1024), // MB
        heapTotal: newMemUsage.heapTotal / (1024 * 1024), // MB
        heapUsed: newMemUsage.heapUsed / (1024 * 1024), // MB
        external: newMemUsage.external / (1024 * 1024) // MB
      }
    });
    
    this.cpuUsage = process.cpuUsage();
  }

  stop() {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
    
    // Take one last sample
    this.sample();
    
    return this.getResults();
  }

  getResults() {
    if (this.samples.length === 0) {
      return { cpu: 0, memory: { rss: 0, heapTotal: 0, heapUsed: 0, external: 0 } };
    }
    
    // Calculate averages
    const sum = this.samples.reduce((acc, sample) => {
      return {
        cpu: acc.cpu + sample.cpu,
        memory: {
          rss: acc.memory.rss + sample.memory.rss,
          heapTotal: acc.memory.heapTotal + sample.memory.heapTotal,
          heapUsed: acc.memory.heapUsed + sample.memory.heapUsed,
          external: acc.memory.external + sample.memory.external
        }
      };
    }, { cpu: 0, memory: { rss: 0, heapTotal: 0, heapUsed: 0, external: 0 } });
    
    const count = this.samples.length;
    
    // Find peak values
    const peak = this.samples.reduce((acc, sample) => {
      return {
        cpu: Math.max(acc.cpu, sample.cpu),
        memory: {
          rss: Math.max(acc.memory.rss, sample.memory.rss),
          heapTotal: Math.max(acc.memory.heapTotal, sample.memory.heapTotal),
          heapUsed: Math.max(acc.memory.heapUsed, sample.memory.heapUsed),
          external: Math.max(acc.memory.external, sample.memory.external)
        }
      };
    }, { cpu: 0, memory: { rss: 0, heapTotal: 0, heapUsed: 0, external: 0 } });
    
    return {
      average: {
        cpu: sum.cpu / count,
        memory: {
          rss: sum.memory.rss / count,
          heapTotal: sum.memory.heapTotal / count,
          heapUsed: sum.memory.heapUsed / count,
          external: sum.memory.external / count
        }
      },
      peak: peak,
      samples: this.samples
    };
  }
  
  printResults(label) {
    const results = this.getResults();
    console.log(`\n==== ${label} Resource Usage ====`);
    console.log(`Average CPU Usage: ${results.average.cpu.toFixed(2)}%`);
    console.log(`Peak CPU Usage: ${results.peak.cpu.toFixed(2)}%`);
    console.log(`Average Memory (RSS): ${results.average.memory.rss.toFixed(2)}MB`);
    console.log(`Peak Memory (RSS): ${results.peak.memory.rss.toFixed(2)}MB`);
    console.log(`Average Heap Used: ${results.average.memory.heapUsed.toFixed(2)}MB`);
    console.log(`Peak Heap Used: ${results.peak.memory.heapUsed.toFixed(2)}MB`);
    
    return results;
  }
}

// Helper function to create a specific size image buffer
async function createTestImageBuffer(sizeMB) {
  try {
    // Check if sample image exists
    if (!fs.existsSync(SAMPLE_IMAGE_PATH)) {
      console.error(`Sample image not found at ${SAMPLE_IMAGE_PATH}`);
      console.error('Please provide a sample image for the benchmark');
      process.exit(1);
    }

    // Read the sample image
    const sampleImage = fs.readFileSync(SAMPLE_IMAGE_PATH);
    
    // Calculate how many copies we need to reach desired size
    const targetSizeBytes = sizeMB * 1024 * 1024;
    const requiredCopies = Math.ceil(targetSizeBytes / sampleImage.length);
    
    // Create a buffer of roughly the target size
    let buffer = Buffer.alloc(0);
    for (let i = 0; i < requiredCopies; i++) {
      buffer = Buffer.concat([buffer, sampleImage]);
    }
    
    // Trim to exact size if needed
    if (buffer.length > targetSizeBytes) {
      buffer = buffer.subarray(0, targetSizeBytes);
    }
    
    // If we're short on bytes (unlikely but possible), pad the buffer
    if (buffer.length < targetSizeBytes) {
      const paddingBuffer = Buffer.alloc(targetSizeBytes - buffer.length);
      buffer = Buffer.concat([buffer, paddingBuffer]);
    }
    
    // Verify size
    const actualSizeMB = buffer.length / (1024 * 1024);
    if (Math.abs(actualSizeMB - sizeMB) > 0.01) {
      console.warn(`Warning: Requested ${sizeMB}MB but got ${actualSizeMB.toFixed(2)}MB`);
    }
    
    return buffer;
  } catch (error) {
    console.error('Error creating test image buffer:', error);
    throw error;
  }
}

// Helper function to send a request with multiple files
async function sendImageResizeRequest(numImages, imageBuffer) {
  const formData = new FormData();
  
  // Add the specified number of images to the request
  for (let i = 0; i < numImages; i++) {
    formData.append('media', imageBuffer, { filename: `test_image_${i + 1}.jpg` });
  }
  
  const startTime = performance.now();
  
  try {
    const response = await axios.post(SERVER_URL, formData, {
      headers: {
        ...formData.getHeaders(),
      },
      maxContentLength: Infinity,
      maxBodyLength: Infinity,
    });
    
    const endTime = performance.now();
    const duration = endTime - startTime;
    
    return {
      success: true,
      duration,
      timings: response.data.timings,
      sizes: response.data.sizes
    };
  } catch (error) {
    const endTime = performance.now();
    const duration = endTime - startTime;
    
    return {
      success: false,
      duration,
      error: error.message
    };
  }
}

// Helper function to get system memory in MB
function getSystemMemoryMB() {
  return os.totalmem() / (1024 * 1024);
}

// Safety monitoring function
function startSafetyMonitor() {
  const memoryThresholdMB = Math.min(
    getSystemMemoryMB() * (SAFETY_LIMITS.maxMemoryThresholdPercent / 100),
    SAFETY_LIMITS.maxMemoryThresholdMB
  );
  
  console.log(`\n==== SAFETY MONITORING ====`);
  console.log(`System memory: ${Math.round(getSystemMemoryMB())} MB`);
  console.log(`Memory threshold: ${Math.round(memoryThresholdMB)} MB`);
  
  const interval = setInterval(() => {
    const memUsage = process.memoryUsage();
    const rssMemoryMB = memUsage.rss / (1024 * 1024);
    
    if (rssMemoryMB > memoryThresholdMB) {
      console.error(`\n⚠️ SAFETY ALERT: Memory usage exceeds threshold (${Math.round(rssMemoryMB)} MB > ${Math.round(memoryThresholdMB)} MB)`);
      console.error(`Terminating benchmark to prevent system overload.`);
      process.exit(1);
    }
  }, 1000);
  
  return interval;
}

// Enhanced runConcurrentRequests function with safety limits
async function runConcurrentRequests(numRequests, numImagesPerRequest, imageBuffer) {
  // Apply safety limits
  const adjustedNumRequests = Math.min(numRequests, SAFETY_LIMITS.maxConcurrentRequests);
  if (adjustedNumRequests < numRequests) {
    console.log(`\n⚠️ SAFETY LIMIT APPLIED: Reduced concurrent requests from ${numRequests} to ${adjustedNumRequests}`);
  }
  
  console.log(`Running ${adjustedNumRequests} concurrent requests with ${numImagesPerRequest} images per request...`);
  
  // Set up safety timeout
  const timeoutPromise = new Promise((_, reject) => {
    setTimeout(() => {
      reject(new Error(`Timeout: Scenario took longer than ${SAFETY_LIMITS.maxTimePerScenarioSec} seconds`));
    }, SAFETY_LIMITS.maxTimePerScenarioSec * 1000);
  });
  
  const monitor = new ResourceMonitor();
  monitor.start();
  
  const requests = [];
  for (let i = 0; i < adjustedNumRequests; i++) {
    requests.push(sendImageResizeRequest(numImagesPerRequest, imageBuffer));
  }
  
  const startTime = performance.now();
  
  try {
    // Race against timeout
    const results = await Promise.race([
      Promise.all(requests),
      timeoutPromise
    ]);
    
    const endTime = performance.now();
    const totalDuration = endTime - startTime;
    const successCount = results.filter(r => r.success).length;
    
    const resourceUsage = monitor.stop();
    monitor.printResults(`${adjustedNumRequests} Concurrent Requests`);
    
    console.log(`\nResults for ${adjustedNumRequests} concurrent requests:`);
    console.log(`Total time: ${totalDuration.toFixed(2)}ms (${(totalDuration / 1000).toFixed(2)} seconds)`);
    console.log(`Success rate: ${successCount}/${adjustedNumRequests} (${(successCount / adjustedNumRequests * 100).toFixed(2)}%)`);
    
    const successfulResults = results.filter(r => r.success);
    if (successfulResults.length > 0) {
      const avgDuration = successfulResults.reduce((sum, r) => sum + r.duration, 0) / successfulResults.length;
      console.log(`Average request duration: ${avgDuration.toFixed(2)}ms (${(avgDuration / 1000).toFixed(2)} seconds)`);
      
      // Calculate average processing time per image if available
      const avgProcessingTime = successfulResults.reduce((sum, r) => {
        if (r.timings && r.timings.totalProcessingTime) {
          return sum + r.timings.totalProcessingTime;
        }
        return sum;
      }, 0) / successfulResults.length;
      
      console.log(`Average processing time: ${avgProcessingTime.toFixed(2)}ms (${(avgProcessingTime / 1000).toFixed(2)} seconds)`);
      
      // Log compression ratios if available
      const firstSuccessfulResult = successfulResults[0];
      if (firstSuccessfulResult.sizes) {
        const { totalOriginalSize, totalProcessedSize } = firstSuccessfulResult.sizes;
        console.log('\nCompression Results:');
        console.log(`Original Size (per file): ${(totalOriginalSize / 1024 / numImagesPerRequest).toFixed(2)}MB`);
        console.log(`Total Original Size: ${(totalOriginalSize / 1024).toFixed(2)}MB`);
        
        if (totalProcessedSize) {
          Object.entries(totalProcessedSize).forEach(([quality, size]) => {
            const ratio = totalOriginalSize / size;
            console.log(`${quality.charAt(0).toUpperCase() + quality.slice(1)} Quality: ${(size / 1024).toFixed(2)}MB (${ratio.toFixed(2)}x smaller)`);
          });
        }
      }
    }
    
    return { results, resourceUsage };
  } catch (error) {
    monitor.stop();
    console.error(`\n⚠️ SAFETY MECHANISM TRIGGERED: ${error.message}`);
    return { results: [], resourceUsage: null, safetyTriggered: true };
  }
}

// Main benchmark function
async function runBenchmarks() {
  try {
    // Start safety monitoring
    const safetyMonitor = startSafetyMonitor();
    
    console.log('Creating test image buffer...');
    const imageBuffer = await createTestImageBuffer(TARGET_SIZE_MB);
    console.log(`Created test image buffer of ${(imageBuffer.length / (1024 * 1024)).toFixed(2)}MB`);
    
    // Run with adaptive approach - scale down if we encounter issues
    const scenarios = [
      { name: "Single request with 8 images", concurrency: 1, images: 8 },
      { name: "10 concurrent requests with 8 images each", concurrency: 10, images: 8 },
      { name: "50 concurrent requests with 8 images each", concurrency: 50, images: 8 }
    ];
    
    let previousScenarioFailed = false;
    
    for (const scenario of scenarios) {
      if (previousScenarioFailed) {
        console.log(`\n⚠️ Skipping scenario "${scenario.name}" due to previous failure`);
        continue;
      }
      
      console.log(`\n========== SCENARIO: ${scenario.name} ==========`);
      
      // For single request
      if (scenario.concurrency === 1) {
        const monitor = new ResourceMonitor();
        monitor.start();
        
        const singleResult = await sendImageResizeRequest(scenario.images, imageBuffer);
        
        const resourceUsage = monitor.stop();
        monitor.printResults(`Single Request (${scenario.images} images)`);
        
        if (singleResult.success) {
          console.log(`Request completed successfully in ${singleResult.duration.toFixed(2)}ms (${(singleResult.duration / 1000).toFixed(2)} seconds)`);
          console.log(`Processing time: ${singleResult.timings.totalProcessingTime.toFixed(2)}ms (${(singleResult.timings.totalProcessingTime / 1000).toFixed(2)} seconds)`);
          
          if (singleResult.sizes) {
            const { totalOriginalSize, totalProcessedSize } = singleResult.sizes;
            console.log('\nCompression Results:');
            console.log(`Original Size (per file): ${(totalOriginalSize / 1024 / scenario.images).toFixed(2)}MB`);
            console.log(`Total Original Size: ${(totalOriginalSize / 1024).toFixed(2)}MB`);
            
            if (totalProcessedSize) {
              Object.entries(totalProcessedSize).forEach(([quality, size]) => {
                const ratio = totalOriginalSize / size;
                console.log(`${quality.charAt(0).toUpperCase() + quality.slice(1)} Quality: ${(size / 1024).toFixed(2)}MB (${ratio.toFixed(2)}x smaller)`);
              });
            }
          }
        } else {
          console.log(`Request failed after ${singleResult.duration.toFixed(2)}ms: ${singleResult.error}`);
          previousScenarioFailed = true;
        }
      } else {
        // For concurrent requests
        const result = await runConcurrentRequests(scenario.concurrency, scenario.images, imageBuffer);
        if (result.safetyTriggered) {
          previousScenarioFailed = true;
        }
      }
      
      // Ensure we have a delay between scenarios
      console.log(`\nCooling down for ${SAFETY_LIMITS.minDelayBetweenScenariosSec} seconds before next scenario...`);
      await new Promise(resolve => setTimeout(resolve, SAFETY_LIMITS.minDelayBetweenScenariosSec * 1000));
    }
    
    // Analyze resource usage and suggest optimizations if we have results
    if (!previousScenarioFailed) {
      console.log('\n\n========== OPTIMIZATION SUGGESTIONS ==========');
      // (optimization suggestions remain the same)
      console.log('✅ General optimization suggestions for app.js:');
      console.log('1. Add Sharp cache control: `sharp.cache(false)` to reduce memory usage');
      console.log('2. Implement worker_threads for parallel image processing');
      console.log('3. Add a request throttling middleware to prevent server overload');
      console.log('4. Consider using streams instead of buffers for large images');
      console.log('5. Add timeout limits for image processing operations');
      console.log('6. Implement caching for processed images to avoid re-processing');
    }
    
    // Clean up safety monitor
    clearInterval(safetyMonitor);
    
  } catch (error) {
    console.error('Benchmark failed:', error);
  }
}

// Run the benchmarks
runBenchmarks().then(() => {
  console.log('\nBenchmarking complete!');
  return true;
}).catch(error => {
  console.error('Fatal error during benchmarking:', error);
  return false;
}); 