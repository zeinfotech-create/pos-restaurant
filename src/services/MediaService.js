/**
 * MediaService.js
 * Handles image processing and Base64 conversion for database storage.
 */
export const MediaService = {
    /**
     * Converts a File object to a Base64 string.
     * @param {File} file 
     * @returns {Promise<string>}
     */
    fileToBase64(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.readAsDataURL(file);
            reader.onload = () => resolve(reader.result);
            reader.onerror = error => reject(error);
        });
    },

    /**
     * Handles image selection event, automatically resizes large images,
     * and returns an optimized Base64 string.
     */
    async handleImageUpload(event, maxSizeMB = 15) {
        const file = event.target.files[0];
        if (!file) return null;

        if (!file.type.startsWith('image/')) {
            throw new Error('Please upload an image file');
        }

        if (file.size > maxSizeMB * 1024 * 1024) {
            throw new Error(`Image must be under ${maxSizeMB}MB`);
        }

        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = (e) => {
                const img = new Image();
                img.onload = () => {
                    // The whole point of resizing here is to avoid ever storing/
                    // rendering a huge image, but the resize step itself can
                    // still fail on one (getContext returning null, drawImage/
                    // toDataURL throwing on a very large canvas) — without this
                    // try/catch that left the Promise permanently pending, since
                    // nothing outside this callback could ever resolve/reject it.
                    try {
                        const canvas = document.createElement('canvas');
                        const MAX_SIZE = 1024; // Max width or height
                        let width = img.width;
                        let height = img.height;

                        if (width > height) {
                            if (width > MAX_SIZE) {
                                height *= MAX_SIZE / width;
                                width = MAX_SIZE;
                            }
                        } else {
                            if (height > MAX_SIZE) {
                                width *= MAX_SIZE / height;
                                height = MAX_SIZE;
                            }
                        }

                        canvas.width = width;
                        canvas.height = height;
                        const ctx = canvas.getContext('2d');
                        if (!ctx) throw new Error('Could not create a canvas context to resize this image.');

                        // High-quality interpolation
                        ctx.imageSmoothingEnabled = true;
                        ctx.imageSmoothingQuality = 'high';

                        ctx.drawImage(img, 0, 0, width, height);

                        // Export as optimized JPEG to save DB space
                        resolve(canvas.toDataURL('image/jpeg', 0.7));
                    } catch (err) {
                        reject(new Error('Failed to process the selected image: ' + err.message));
                    }
                };
                img.onerror = () => reject(new Error('The selected image could not be loaded.'));
                img.src = e.target.result;
            };
            reader.onerror = () => reject(new Error('Failed to read the selected file.'));
            reader.readAsDataURL(file);
        });
    },

    /**
     * Handles a supplier bill/invoice attachment — images get the same
     * resize/compress treatment as handleImageUpload(); PDFs are stored as-is
     * (can't be canvas-resized) but capped in size since they aren't compressed.
     */
    async handleBillUpload(event, maxSizeMB = 5) {
        const file = event.target.files[0];
        if (!file) return null;

        if (file.type.startsWith('image/')) {
            return this.handleImageUpload(event, maxSizeMB);
        }

        if (file.type === 'application/pdf') {
            if (file.size > maxSizeMB * 1024 * 1024) {
                throw new Error(`PDF must be under ${maxSizeMB}MB`);
            }
            return this.fileToBase64(file);
        }

        throw new Error('Please upload an image or PDF file');
    }
};
