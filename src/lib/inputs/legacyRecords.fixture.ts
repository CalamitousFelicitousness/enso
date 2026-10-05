// Canvas records as older builds stored them, dumped from a browser profile on
// 2026-10-05. Bytes are replaced by zeros of the same length.

const zeros = (name: string, size: number, lastModified: number) =>
  new File([new Uint8Array(size)], name, { type: "image/png", lastModified });

/** The version 4 record under "enso-canvas-v4": an Initial frame whose layer
 * was copied into its Reference arm by a mode switch. */
export function canvasV4Record() {
  return {
    state: {
      viewport: { x: 441.4369791666667, y: 372, scale: 1 },
      activeTool: "move",
      brushSize: 20,
      brushHardness: 0.8,
      brushColor: "#ffffff",
      brushOpacity: 1,
      maskVisible: true,
      maskColor: "#ff000080",
      panelCollapsedOverrides: [],
      canvasMode: "canvas",
      focusedFrameId: null,
      modeLocked: false,
      inputFrames: [
        {
          id: "9437fdbd-9bb8-44a3-8647-9a5baaa58928",
          mode: "initial",
          layers: [
            {
              id: "b0bd3c43-05d3-4554-b733-41380b97eea5",
              type: "image",
              name: "ref-1024.png",
              visible: true,
              opacity: 1,
              locked: false,
              file: zeros("ref-1024.png", 1510360, 1790806467694),
              naturalWidth: 1024,
              naturalHeight: 1024,
              x: 0,
              y: 416,
              width: 1024,
              height: 1024,
              rotation: 0,
              scaleX: 1.0625,
              scaleY: 1.0625,
            },
          ],
          activeLayerId: null,
          maskLines: [],
          references: [
            {
              id: "ecc8d8fa-0ad4-4068-a1ec-5bd9723cc980",
              file: zeros("ref-1024.png", 1510360, 1790806467694),
              naturalWidth: 1024,
              naturalHeight: 1024,
              filename: "ref-1024.png",
            },
          ],
        },
      ],
      activeInputFrameId: "9437fdbd-9bb8-44a3-8647-9a5baaa58928",
      sizeSource: null,
    },
    version: 4,
  };
}

/** The version 3 record under "enso-canvas", stored as JSON text: a Reference
 * frame with one layer left in its Initial arm. */
export const CANVAS_V3_RECORD =
  '{"state":{"viewport":{"x":201.328125,"y":323.25,"scale":1},"activeTool":"move","brushSize":20,"brushHardness":0.8,"brushColor":"#ffffff","brushOpacity":1,"maskVisible":true,"maskColor":"#ff000080","panelCollapsedOverrides":[],"canvasMode":"canvas","focusedFrameId":null,"modeLocked":false,"inputFrames":[{"id":"9437fdbd-9bb8-44a3-8647-9a5baaa58928","mode":"reference","layers":[{"id":"orphan-layer-test","type":"image","name":"leftover.png","visible":true,"opacity":1,"locked":false,"base64":"iVBORw0KGgoAAAANSUhEUgAAAGMAAACXCAYAAAABOOWaAAADPUlEQVR4AeyTQU4lUQwDvzgbZ+G03Ak2bCxlkc5zxw3USCPkpyT+qlK/fb5/fPH/GQzeXvx7DAFkPEbF64UMZDyIwIN+Cl8GMh5E4EE/hS8DGQ8i8KCfwpeBjB8C/BECfBmCIxuQkeUv7cgQHNmAjCx/aUeG4MgGZGT5SzsyBEc2ICPLX9qRITiy4T/LyJIv2pFRQEk9ISNFvuhFRgEl9YSMFPmiFxkFlNQTMlLki15kFFBST8hIkS96kVFAST0hI0W+6EVGASX1hIwU+aIXGQWU1BMyUuSLXmQUUFJPyEiRL3qRUUBJPSEjRb7oRUYBJfWEjBT5ondRRtHOkxBAhuDIBmRk+Us7MgRHNiAjy1/akSE4sgEZWf7SjgzBkQ3IyPKXdmQIjmz4NzKymHvtyOhxWplCxgrmXgkyepxWppCxgrlXgowep5UpZKxg7pUgo8dpZQoZK5h7JcjocVqZQsYK5l4JMnqcVqaQsYK5V4KMHqeVKWSsYO6VIKPHaWUKGSuYeyXI6HFamULGCuZeCTJ6nFamkLGCuVdyl4xeO1NCABmCIxuQkeUv7cgQHNmAjCx/aUeG4MgGZGT5SzsyBEc2ICPLX9qRITiy4W/KyDIdtyNjjM6/iAw/0/FFZIzR+ReR4Wc6voiMMTr/IjL8TMcXkTFG519Ehp/p+CIyxuj8i8jwMx1fRMYYnX8RGX6m44vIGKPzLyLDz3R8ERljdP5FZPiZji8iY4zOv4gMP9PxRWSM0fkXkeFnOr5okTFuZ1EIIENwZAMysvylHRmCIxuQkeUv7cgQHNmAjCx/aUeG4MgGZGT5SzsyBEc2/AEZWYDOdmQ4aR7eQsYhQOc6Mpw0D28h4xCgcx0ZTpqHt5BxCNC5jgwnzcNbyDgE6FxHhpPm4S1kHAJ0riPDSfPwFjIOATrXkeGkeXgLGYcAnevIcNI8vIWMQ4DOdWQ4aR7eQsYhQOc6Mpw0D28h4xCgc/26DGc7t4QAMgRHNiAjy1/akSE4sgEZWf7SjgzBkQ3IyPKXdmQIjmxARpa/tCNDcGTDb5ORpXVzOzJuBnzlPDKu0Lp5Fhk3A75yHhlXaN08i4ybAV85j4wrtG6e/QYAAP//BfZmcwAAAAZJREFUAwCsKvRuXt9mAwAAAABJRU5ErkJggg==","naturalWidth":99,"naturalHeight":151,"x":0,"y":0,"width":99,"height":151,"rotation":0,"scaleX":1,"scaleY":1,"imageData":""}],"activeLayerId":null,"maskLines":[],"maskData":null,"references":[]}],"activeInputFrameId":"9437fdbd-9bb8-44a3-8647-9a5baaa58928"},"version":3}';
