// client/ui/chat.js
// Press Enter to open a small text box, type, Enter again to send (Esc cancels).
// Messages appear as bubbles over players' heads (see effects.js) and in a
// short log in the bottom-left corner.

import { MAX_CHAT_LENGTH } from '../../shared/constants.js';

export function createChat({ onSend, input, onOpen, onClose }) {
  const box = document.createElement('input');
  box.className = 'chat-input';
  box.maxLength = MAX_CHAT_LENGTH;
  box.placeholder = 'Say something… (Enter to send, Esc to cancel)';
  box.style.display = 'none';
  const log = document.createElement('div');
  log.className = 'chat-log';
  document.body.append(log, box);

  function open() {
    box.style.display = 'block';
    box.value = '';
    box.focus();
    input.enabled = false; // stop walking while typing
    onOpen?.();
  }
  function close(byKey = false) {
    if (box.style.display === 'none') return;
    box.style.display = 'none';
    box.blur();
    input.enabled = true;
    onClose?.(byKey);
  }

  window.addEventListener('keydown', (e) => {
    if (e.code === 'Enter' && document.activeElement !== box && !(e.target instanceof HTMLInputElement)) {
      e.preventDefault();
      open();
    }
  });
  box.addEventListener('keydown', (e) => {
    if (e.code === 'Enter') {
      const text = box.value.trim();
      if (text) onSend(text);
      close(true);
    } else if (e.code === 'Escape') {
      close(false);
    }
    e.stopPropagation();
  });
  box.addEventListener('blur', () => close(false));

  return {
    open,
    // Add a line to the log (keeps the last 6, each fades after 12 s).
    add(name, text, color) {
      const line = document.createElement('div');
      const who = document.createElement('b');
      who.textContent = name + ': ';
      who.style.color = color;
      line.append(who, document.createTextNode(text));
      log.append(line);
      while (log.children.length > 6) log.firstChild.remove();
      setTimeout(() => line.classList.add('old'), 12000);
    },
  };
}
