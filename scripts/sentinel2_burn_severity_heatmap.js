//VERSION=3

/*
 * This script is licensed under the MIT License.
 * Copyright (c) 2025 Edoardo Tosin
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies
 * of the Software, and to permit persons to whom the Software is furnished to do so,
 * subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in all
 * copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED,
 * INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR
 * PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE
 * FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE,
 * ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
 */

// Define the temporal range for image selection
// This range ensures the inclusion of pre-fire and post-fire Sentinel-2 observations for burn severity analysis.
var fromDate = new Date("2025-01-01");  // Start date for the pre-fire observation
var toDate = new Date("2025-01-13");    // End date for the post-fire observation

// Sentinel-2 Scene Classification Layer (SCL) values for masking irrelevant or unreliable surface types
// These classes include no data, defective pixels, and surfaces unsuitable for burn severity analysis (e.g., water, clouds).
const excludedClasses = [0, 1, 3, 6, 7, 8, 9, 10, 11]; // Excludes: no data, saturated/defective pixels, water, snow/ice, cloud shadows, clouds, and unclassified pixels.

// Thresholds for burn severity classification based on the Relativized Burn Ratio (RBR)
// Each class is assigned a transparency level (alpha channel) for visualization purposes.
const thresholds = [
  { max: 0.1, alpha: 0.0, label: 'Unburnt' },             // RBR ≤ 0.1 indicates unburned areas.
  { max: 0.27, alpha: 0.3, label: 'Low severity' },       // 0.1 < RBR ≤ 0.27 indicates low severity burns.
  { max: 0.44, alpha: 0.5, label: 'Moderate severity' },  // 0.27 < RBR ≤ 0.44 indicates moderate severity burns.
  { max: 0.66, alpha: 0.7, label: 'Moderate-high severity' }, // 0.44 < RBR ≤ 0.66 indicates moderate to high severity burns.
  { max: Infinity, alpha: 1.0, label: 'High severity' }   // RBR > 0.66 indicates high severity burns.
];

// Compute the Normalized Burn Ratio (NBR), an index sensitive to changes in vegetation and burn effects.
// NBR is derived from the Near-Infrared (NIR) and Short-Wave Infrared (SWIR) bands: NBR = (NIR - SWIR) / (NIR + SWIR).
function calculateNBR(NIR, SWIR) {
  return (NIR - SWIR) / (NIR + SWIR); // Normalized formula emphasizing vegetation structure and moisture content.
}

// Compute the Relativized Burn Ratio (RBR), an advanced metric accounting for pre-fire vegetation conditions.
// RBR = dNBR / sqrt(|preFireNBR|); this normalization adjusts for variations in pre-fire vegetation states.
function calculateRBR(dNBR, preFireNBR) {
  return dNBR / Math.sqrt(Math.abs(preFireNBR)); // Ensures sensitivity to pre-fire conditions.
}

// Smooth data using a simple moving average within the same dataset for spatial noise reduction.
// This function smooths a dataset by applying a moving average filter with a specified window size.
function smoothData(dataset, windowSize) {
  let smoothedValues = [];
  
  // Loop through each pixel in the dataset
  for (let i = 0; i < dataset.length; i++) {
    let sum = 0, count = 0;
    // Apply moving average on neighboring pixels within the same dataset
    for (let j = i - Math.floor(windowSize / 2); j <= i + Math.floor(windowSize / 2); j++) {
      if (j >= 0 && j < dataset.length) {
        sum += dataset[j];
        count++;
      }
    }
    smoothedValues.push(sum / count);
  }
  
  return smoothedValues;
}

// Filter Sentinel-2 scenes for relevant temporal ranges and process pre- and post-fire images.
// The function retains images strictly within the defined date range and ensures at least one pre- and post-fire scene.
function preProcessScenes(collections) {
  // Retain scenes within the analysis period.
  collections.scenes.orbits = collections.scenes.orbits.filter(orbit =>
    new Date(orbit.dateFrom) >= fromDate &&
    new Date(orbit.dateTo) <= toDate
  );
  
  // Chronologically sort scenes to maintain temporal order.
  collections.scenes.orbits.sort((a, b) => new Date(a.dateFrom) - new Date(b.dateFrom));
  
  // Select the earliest and latest scenes for pre- and post-fire analysis, if sufficient data exists.
  if (collections.scenes.orbits.length >= 2) {
    collections.scenes.orbits = [
      collections.scenes.orbits[0], // First scene: pre-fire
      collections.scenes.orbits[collections.scenes.orbits.length - 1] // Last scene: post-fire
    ];
  } else {
    return []; // Insufficient data for analysis: return an empty array.
  }
  
  return collections;
}

// Define input bands and data properties for Sentinel-2 processing.
// This ensures compatibility with Sentinel-2 data, focusing on relevant spectral bands and metadata.
function setup() {
  return {
    input: [
      {
        bands: ["B08", "B12", "SCL", "dataMask"], // Input: NIR (B08), SWIR (B12), Scene Classification Layer (SCL), and data mask.
        units: ["REFLECTANCE", "REFLECTANCE", "DN", "DN"] // Units: Reflectance for spectral bands, DN for SCL and mask.
      }
    ],
    output: { bands: 4 }, // Output format: RGBA (Red, Green, Blue, Alpha).
    mosaicking: "ORBIT" // Process data by orbit to maintain temporal consistency.
  };
}

// Map RBR values to a color in a heatmap from green (low severity) to red (high severity).
// This function maps the RBR value to RGB values where lower RBR indicates a green color (indicating low severity), and higher RBR indicates a red color (indicating high severity).
function getHeatmapColor(RBR) {
  var red = Math.min(255, Math.max(0, Math.round(RBR * 255)));  // Red channel increases with higher RBR values.
  var green = Math.min(255, Math.max(0, Math.round((1 - RBR) * 255)));  // Green decreases as RBR increases.
  var blue = 0; // The blue channel remains at 0, as we are focusing on the red-to-green gradient for burn severity.
  
  return [red, green, blue]; // Return the RGB color representation for visualization.
}

// Non-linear transformation of alpha values to adjust transparency levels.
// This function reduces the opacity of lower severity classes, thereby minimizing the visual impact of noise and enhancing the prominence of areas with higher burn severity.
function adjustTransparency(alpha) {
  return Math.pow(alpha, 2);
}

// Classify and visualize burn severity for each pixel using RBR and defined thresholds.
// Pixels with excluded surface types or missing data are rendered transparent (alpha = 0).
function evaluatePixel(samples) {
  // Ensure exactly two samples (pre-fire and post-fire) for comparison.
  if (samples.length !== 2) {
    return [0, 0, 0, 0]; // Transparent output for insufficient data.
  }
  
  // Extract pre-fire and post-fire sample data.
  const firstSample = samples[0]; // Pre-fire sample.
  const lastSample = samples[1];  // Post-fire sample.
  
  // Exclude pixels belonging to irrelevant surface types using the Scene Classification Layer (SCL).
  const isExcludedPreFire = excludedClasses.includes(firstSample.SCL);
  const isExcludedPostFire = excludedClasses.includes(lastSample.SCL);
  
  if (isExcludedPreFire || isExcludedPostFire) {
    return [0, 0, 0, 0]; // Transparent output for excluded surface types (e.g., water, clouds).
  }
  
  // Compute NBR for pre-fire and post-fire images.
  const rawNBRPreFire = calculateNBR(firstSample.B08, firstSample.B12); // Pre-fire NBR.
  const rawNBRPostFire = calculateNBR(lastSample.B08, lastSample.B12); // Post-fire NBR.
  
  // Smooth the NBR data spatially within each dataset
  const smoothedPreFire = smoothData([rawNBRPreFire], 3);
  const smoothedPostFire = smoothData([rawNBRPostFire], 3);
  
  const firstNBR = smoothedPreFire[0]; // Smoothed pre-fire NBR.
  const lastNBR = smoothedPostFire[0]; // Smoothed post-fire NBR.
  
  // Calculate the change in NBR (dNBR) to assess vegetation loss.
  const dNBR = firstNBR - lastNBR;
  
  // Compute RBR for burn severity classification.
  const RBR = calculateRBR(dNBR, firstNBR);
  
  // Map the RBR value to a color on the heatmap (from green to red).
  const rgbColor = getHeatmapColor(RBR);
  
  // Determine burn severity and corresponding transparency (alpha) using defined thresholds.
  let alpha = 0.0;
  thresholds.some(threshold => {
    if (RBR <= threshold.max) {
      alpha = threshold.alpha;
      return true; // Exit loop once a matching threshold is found.
    }
    return false;
  });
  
  // Apply non-linear transparency adjustment.
  alpha = adjustTransparency(alpha);
  
  // Return the RGB color and transparency (alpha) based on burn severity.
  return [...rgbColor, alpha];
}
