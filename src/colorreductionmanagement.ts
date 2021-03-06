/**
 * Color reduction management of the process: clustering to reduce colors & creating color map
 */
import { Uint8Array2D } from "./structs/typedarrays";
import { IMap, RGB, delay } from "./common";
import { KMeans, Vector } from "./lib/clustering";
import { Settings, ClusteringColorSpace } from "./settings";
import { rgb2lab, rgbToHsl, hslToRgb, lab2rgb } from "./lib/colorconversion";



export class ColorMapResult {
    imgColorIndices!: Uint8Array2D;
    colorsByIndex!: RGB[];
}

export class ColorReducer {

      /**
     *  Creates a map of the various colors used
     */
     static createColorMap(kmeansImgData: ImageData) {
        let imgColorIndices = new Uint8Array2D(kmeansImgData.width, kmeansImgData.height);
        let colorIndex = 0;
        let colors: IMap<number> = {};
        let colorsByIndex: RGB[] = [];

        let idx = 0;
        for (let j: number = 0; j < kmeansImgData.height; j++) {
            for (let i: number = 0; i < kmeansImgData.width; i++) {
                let r = kmeansImgData.data[idx++];
                let g = kmeansImgData.data[idx++];
                let b = kmeansImgData.data[idx++];
                let a = kmeansImgData.data[idx++];
                let currentColorIndex;
                let color = r + "," + g + "," + b;
                if (typeof colors[color] === "undefined") {
                    currentColorIndex = colorIndex;
                    colors[color] = colorIndex;
                    colorsByIndex.push([r, g, b]);
                    colorIndex++;
                }
                else {
                    currentColorIndex = colors[color];
                }
                imgColorIndices.set(i, j, currentColorIndex);
            }
        }

        let result = new ColorMapResult();
        result.imgColorIndices = imgColorIndices;
        result.colorsByIndex = colorsByIndex;
        return result;
    }

    /**
     *  Applies K-means clustering on the imgData to reduce the colors to
     *  k clusters and then output the result to the given outputImgData
     */
     static async applyKMeansClustering(imgData: ImageData, outputImgData: ImageData, ctx: CanvasRenderingContext2D, settings: Settings, onUpdate: ((kmeans: KMeans) => void) | null = null) {
        let vectors: Vector[] = [];
        let idx = 0;
        let vIdx = 0;

        // group by color, add points as 1D index to prevent Point object allocation
        let pointsByColor: IMap<number[]> = {};
        for (let j: number = 0; j < imgData.height; j++) {
            for (let i: number = 0; i < imgData.width; i++) {
                let r = imgData.data[idx++];
                let g = imgData.data[idx++];
                let b = imgData.data[idx++];
                let a = imgData.data[idx++];

                let color = `${r},${g},${b}`;
                if (!(color in pointsByColor)) {
                    pointsByColor[color] = [j * imgData.width + i];
                }
                else
                    pointsByColor[color].push(j * imgData.width + i);
            }
        }



        for (let color of Object.keys(pointsByColor)) {
            let rgb: number[] = color.split(",").map(v => parseInt(v));

            // determine vector data based on color space conversion
            let data: number[];
            if (settings.kMeansClusteringColorSpace == ClusteringColorSpace.RGB)
                data = rgb;
            else if (settings.kMeansClusteringColorSpace == ClusteringColorSpace.HSL)
                data = rgbToHsl(rgb[0], rgb[1], rgb[2]);
            else if (settings.kMeansClusteringColorSpace == ClusteringColorSpace.LAB)
                data = rgb2lab(rgb);
            else
                data = rgb;
            // determine the weight (#pointsOfColor / #totalpoints) of each color
            let weight = pointsByColor[color].length / (imgData.width * imgData.height);

            let v = new Vector(data, weight);
            vectors[vIdx++] = v;
        }

        // vectors of all the unique colors are built, time to cluster them
        let kmeans = new KMeans(vectors, settings.kMeansNrOfClusters);

        let count = 0;
        kmeans.step();
        while (kmeans.currentDeltaDistanceDifference > settings.kMeansMinDeltaDifference) {
            kmeans.step();

            if (count++ % 2 == 0) {
                await delay(0);
                if (onUpdate != null) {
                    ColorReducer.updateKmeansOutputImageData(kmeans, settings, pointsByColor, imgData, outputImgData);
                    onUpdate(kmeans);
                }
            }

        }

        // update the output image data (because it will be used for further processing)
        ColorReducer.updateKmeansOutputImageData(kmeans, settings, pointsByColor, imgData, outputImgData);

        if (onUpdate != null)
            onUpdate(kmeans);
    }

    /**
     *  Updates the image data from the current kmeans centroids and their respective associated colors (vectors)
     */
    static updateKmeansOutputImageData(kmeans: KMeans, settings: Settings, pointsByColor: IMap<number[]>, imgData: ImageData, outputImgData: ImageData) {

        for (let c: number = 0; c < kmeans.centroids.length; c++) {
            // for each cluster centroid
            let centroid = kmeans.centroids[c];

            // points per category are the different unique colors belonging to that cluster
            for (let v of kmeans.pointsPerCategory[c]) {

                // determine the rgb color value of the cluster centroid
                let rgb: number[];
                if (settings.kMeansClusteringColorSpace == ClusteringColorSpace.RGB) {
                    rgb = centroid.values;
                }
                else if (settings.kMeansClusteringColorSpace == ClusteringColorSpace.HSL) {
                    let hsl = centroid.values;
                    rgb = hslToRgb(hsl[0], hsl[1], hsl[2]);
                }
                else if (settings.kMeansClusteringColorSpace == ClusteringColorSpace.LAB) {
                    let lab = centroid.values;
                    rgb = lab2rgb(lab);
                }
                else
                    rgb = centroid.values;

                // replace all pixels of the old color by the new centroid color
                let pointColor = `${v.values[0]},${v.values[1]},${v.values[2]}`;
                for (let pt of pointsByColor[pointColor]) {
                    let ptx = pt % imgData.width;
                    let pty = Math.floor(pt / imgData.width);
                    let dataOffset = (pty * imgData.width + ptx) * 4;
                    outputImgData.data[dataOffset++] = rgb[0];
                    outputImgData.data[dataOffset++] = rgb[1];
                    outputImgData.data[dataOffset++] = rgb[2];
                }
            }
        }
    }
}