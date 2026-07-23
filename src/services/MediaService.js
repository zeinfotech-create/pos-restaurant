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
    async handleImageUpload(event) {
        const file = event.target.files[0];
        if (!file) return null;

        if (!file.type.startsWith('image/')) {
            throw new Error('Please upload an image file');
        }

        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = (e) => {
                const img = new Image();
                img.onload = () => {
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
                    
                    // High-quality interpolation
                    ctx.imageSmoothingEnabled = true;
                    ctx.imageSmoothingQuality = 'high';
                    
                    ctx.drawImage(img, 0, 0, width, height);

                    // Export as optimized JPEG to save DB space
                    resolve(canvas.toDataURL('image/jpeg', 0.7));
                };
                img.onerror = () => reject(new Error('The selected image could not be loaded.'));
                img.src = e.target.result;
            };
            reader.onerror = () => reject(new Error('Failed to read the selected file.'));
            reader.readAsDataURL(file);
        });
    }
};
