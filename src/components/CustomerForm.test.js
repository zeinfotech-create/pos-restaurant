import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { openCustomerForm } from './CustomerForm';

// Mock DB
vi.mock('../db.js', () => ({
  saveCustomer: vi.fn((cust) => ({ id: 'new-id', ...cust }))
}));

// Mock Modal
vi.mock('./Modal.js', () => ({
  openModal: vi.fn(({ title, body, footer }) => {
    document.body.innerHTML = `
      <div id="pos-modal-overlay">
        <div class="modal-title">${title}</div>
        <div class="modal-body">${body}</div>
        <div class="modal-footer">${footer}</div>
      </div>
    `;
  }),
  closeModal: vi.fn()
}));

// Mock Toast
vi.mock('./Toast.js', () => ({
  showToast: vi.fn()
}));

// Mock MediaService
vi.mock('../services/MediaService.js', () => ({
  MediaService: {
    handleImageUpload: vi.fn().mockResolvedValue('data:image/png;base64,mock')
  }
}));

describe('CustomerForm component', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should open customer form with empty fields for new customer', () => {
    openCustomerForm();
    
    expect(document.getElementById('cName').value).toBe('');
    expect(document.getElementById('cPhone').value).toBe('');
  });

  it('should populate fields when editing customer', () => {
    openCustomerForm({ id: 'c1', name: 'John Doe', phone: '1234567890', image: 'test.jpg' });
    
    expect(document.getElementById('cName').value).toBe('John Doe');
    expect(document.getElementById('cPhone').value).toBe('1234567890');
    expect(document.getElementById('cImageBase64').value).toBe('test.jpg');
  });

  it('should save customer and invoke callback on valid details', async () => {
    const callback = vi.fn();
    const { saveCustomer } = await import('../db.js');
    const { closeModal } = await import('./Modal.js');
    const { showToast } = await import('./Toast.js');

    openCustomerForm(null, callback);
    
    document.getElementById('cName').value = 'Jane Doe';
    document.getElementById('cPhone').value = '9876543210';
    
    document.getElementById('saveCustBtn').click();
    
    expect(saveCustomer).toHaveBeenCalledWith({
      name: 'Jane Doe',
      phone: '9876543210',
      email: '',
      birthday: '',
      image: ''
    });
    
    expect(showToast).toHaveBeenCalledWith('Customer saved!', 'success');
    expect(closeModal).toHaveBeenCalled();
    expect(callback).toHaveBeenCalled();
  });

  it('should show toast error on invalid phone', async () => {
    const { showToast } = await import('./Toast.js');
    
    openCustomerForm();
    
    document.getElementById('cName').value = 'Jane Doe';
    document.getElementById('cPhone').value = '123'; // Invalid
    
    document.getElementById('saveCustBtn').click();
    
    expect(showToast).toHaveBeenCalledWith('Invalid Phone: 10 digits required', 'error');
  });
});
