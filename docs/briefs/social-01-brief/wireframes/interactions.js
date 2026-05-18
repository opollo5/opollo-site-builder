/* ============================================================
   Opollo Wireframes — Interactions
   ============================================================
   Lightweight vanilla JS to bring the wireframes to life so the
   client can click through them. This is REFERENCE behaviour —
   Claude Code's React implementation should replace this with
   proper state management (useState / Zustand / similar).
   ============================================================ */

(() => {
  'use strict';

  // ─── 1. Tab switching (scheduling tabs + preview tabs) ─────
  document.addEventListener('click', (e) => {
    const tab = e.target.closest('.scheduling-tabs__item, .preview-tabs__item, .pill-group__item, .tab-line__item');
    if (!tab) return;

    // Find the active sibling and swap
    const siblings = tab.parentElement.children;
    Array.from(siblings).forEach(s => {
      s.classList.remove('scheduling-tabs__item--active', 'preview-tabs__item--active', 'pill-group__item--active', 'tab-line__item--active');
    });
    if (tab.classList.contains('scheduling-tabs__item')) tab.classList.add('scheduling-tabs__item--active');
    if (tab.classList.contains('preview-tabs__item')) tab.classList.add('preview-tabs__item--active');
    if (tab.classList.contains('pill-group__item')) tab.classList.add('pill-group__item--active');
    if (tab.classList.contains('tab-line__item')) {
      tab.classList.add('tab-line__item--active');
      e.preventDefault();
    }
  });

  // ─── 2. Modal close (X button + backdrop click) ────────────
  document.addEventListener('click', (e) => {
    // Close button inside modal
    if (e.target.closest('.modal__close')) {
      const modal = e.target.closest('.modal-backdrop');
      if (modal) modal.style.display = 'none';
      return;
    }
    // Backdrop click (NOT the modal itself)
    if (e.target.classList.contains('modal-backdrop')) {
      e.target.style.display = 'none';
    }
  });

  // ─── 3. Callout dismiss (Connect-a-Social-Profile tooltip) ─
  document.addEventListener('click', (e) => {
    if (e.target.closest('.callout__close')) {
      const callout = e.target.closest('.callout');
      if (callout) {
        callout.style.transition = 'opacity 200ms ease-out, transform 200ms ease-out';
        callout.style.opacity = '0';
        callout.style.transform = 'scale(0.95)';
        setTimeout(() => { callout.style.display = 'none'; }, 200);
      }
    }
  });

  // ─── 4. Profile chip toggle (composer profile selector) ────
  document.addEventListener('click', (e) => {
    const chip = e.target.closest('.profile-chip:not(.profile-chip__add)');
    if (!chip) return;
    chip.classList.toggle('profile-chip--selected');
    markDirty();
  });

  // ─── 5. Tool button toggle (AI assistant, Emoji etc.) ──────
  document.addEventListener('click', (e) => {
    const btn = e.target.closest('.tool-btn');
    if (!btn) return;
    // Deactivate siblings of the same group, activate this one
    btn.classList.toggle('tool-btn--active');
  });

  // ─── 6. Toggle switches (approval row) ─────────────────────
  document.addEventListener('click', (e) => {
    const toggle = e.target.closest('.toggle');
    if (!toggle) return;
    toggle.classList.toggle('toggle--on');
    const isOn = toggle.classList.contains('toggle--on');
    toggle.setAttribute('aria-checked', String(isOn));
  });

  // ─── 7. Dirty-state tracking + unsaved-changes guard ───────
  // When the user edits the composer, set a flag. If they try to
  // close, intercept with the unsaved-changes modal.
  let isDirty = false;

  function markDirty() { isDirty = true; }
  function markClean() { isDirty = false; }
  window.OPOLLO_markDirty = markDirty;
  window.OPOLLO_markClean = markClean;

  // Watch textarea changes
  document.addEventListener('input', (e) => {
    if (e.target.classList.contains('content-card__textarea')) {
      markDirty();
      // Update char counter
      const counter = e.target.parentElement.querySelector('.content-card__counter');
      if (counter) {
        const limit = 3000;
        const len = e.target.value.length;
        counter.textContent = `${len} / ${limit}`;
        counter.classList.toggle('content-card__counter--over', len > limit);
      }
    }
  });

  // Composer close button: if dirty, show modal instead of closing
  document.addEventListener('click', (e) => {
    const closeBtn = e.target.closest('.composer__close');
    if (!closeBtn) return;
    e.preventDefault();
    if (isDirty) {
      // In a real app this would open the unsaved-changes modal.
      // For wireframes, just fire an alert so the flow is clear.
      const confirmClose = confirm('You have unsaved changes. Discard them?');
      if (confirmClose) {
        markClean();
        const composer = closeBtn.closest('.composer-overlay');
        if (composer) composer.style.display = 'none';
      }
    } else {
      const composer = closeBtn.closest('.composer-overlay');
      if (composer) composer.style.display = 'none';
    }
  });

  // ─── 8. Schedule "Add time" — clone the row ────────────────
  document.addEventListener('click', (e) => {
    const addBtn = e.target.closest('.schedule-add');
    if (!addBtn) return;
    const lastRow = addBtn.parentElement.querySelector('.schedule-row:last-of-type');
    if (lastRow) {
      const newRow = lastRow.cloneNode(true);
      newRow.querySelectorAll('input').forEach(i => { i.value = ''; });
      lastRow.after(newRow);
    }
  });

  // ─── 9. Schedule row delete ────────────────────────────────
  document.addEventListener('click', (e) => {
    const delBtn = e.target.closest('.schedule-row__delete');
    if (!delBtn) return;
    const row = delBtn.closest('.schedule-row');
    if (row && row.parentElement.querySelectorAll('.schedule-row').length > 1) {
      row.remove();
    }
  });

  // ─── 10. Calendar cell "+" — open composer ─────────────────
  document.addEventListener('click', (e) => {
    const addBtn = e.target.closest('.calendar__cell-add');
    if (!addBtn) {
      // Or clicking the day number / blank area selects the day
      const cell = e.target.closest('.calendar__cell:not(.calendar__cell--past):not(.calendar__cell--other-month)');
      if (cell && !cell.classList.contains('calendar__cell--selected')) {
        document.querySelectorAll('.calendar__cell--selected').forEach(c => c.classList.remove('calendar__cell--selected'));
        cell.classList.add('calendar__cell--selected');
      }
      return;
    }
    e.stopPropagation();
    // In the real app, navigate to composer with date pre-filled.
    console.log('Open composer for', addBtn.parentElement.querySelector('.calendar__day-number').textContent);
  });

  // ─── 11. Drag-and-drop scaffolding (calendar reschedule) ───
  // Wireframe-level only; real impl uses HTML5 DnD + PATCH.
  let dragged = null;
  document.addEventListener('dragstart', (e) => {
    if (e.target.classList.contains('day-detail__post')) {
      dragged = e.target;
      e.target.style.opacity = '0.4';
    }
  });
  document.addEventListener('dragend', (e) => {
    if (e.target.classList.contains('day-detail__post')) {
      e.target.style.opacity = '';
      dragged = null;
    }
  });
  document.addEventListener('dragover', (e) => {
    const cell = e.target.closest('.calendar__cell:not(.calendar__cell--past):not(.calendar__cell--other-month)');
    if (cell && dragged) {
      e.preventDefault();
      cell.style.background = 'var(--color-brand-primary-tint)';
    }
  });
  document.addEventListener('dragleave', (e) => {
    const cell = e.target.closest('.calendar__cell');
    if (cell) cell.style.background = '';
  });
  document.addEventListener('drop', (e) => {
    const cell = e.target.closest('.calendar__cell:not(.calendar__cell--past):not(.calendar__cell--other-month)');
    if (cell && dragged) {
      e.preventDefault();
      cell.style.background = '';
      console.log('Reschedule', dragged, 'to', cell.querySelector('.calendar__day-number')?.textContent);
      // In real app: PATCH /api/platform/social/drafts/[id] { scheduledAt: ... }
    }
  });
})();
