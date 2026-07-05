export function openModal({ title, body, onSave, saveLabel = '保存' }) {
  closeAllModals();
  const bg = document.createElement('div');
  bg.className = 'modal-bg';
  bg.onclick = (e) => { if (e.target === bg) closeAllModals(); };

  const modal = document.createElement('div');
  modal.className = 'modal';
  modal.innerHTML = `
    <div class="modal-title">${title}</div>
    <div class="modal-body"></div>
    <div class="modal-footer">
      <button class="btn btn-ghost" id="modal-cancel">取消</button>
      <button class="btn btn-primary" id="modal-save">${saveLabel}</button>
    </div>`;

  modal.querySelector('.modal-body').appendChild(body);
  modal.querySelector('#modal-cancel').onclick = () => closeAllModals();
  modal.querySelector('#modal-save').onclick = async () => {
    try {
      await onSave();
      closeAllModals();
    } catch (err) {
      toast(err.message, 'error');
    }
  };

  bg.appendChild(modal);
  document.body.appendChild(bg);
  document.addEventListener('keydown', escHandler);
}

export function closeAllModals() {
  document.querySelectorAll('.modal-bg').forEach(el => el.remove());
  document.removeEventListener('keydown', escHandler);
}

function escHandler(e) { if (e.key === 'Escape') closeAllModals(); }

export function toast(msg, type = 'success') {
  const t = document.createElement('div');
  t.className = `toast ${type === 'error' ? 'error' : ''}`;
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 3000);
}
