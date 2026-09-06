import { App, Modal, Setting } from 'obsidian';

export class ConfirmModal extends Modal {
  constructor(
    app: App,
    private readonly titleText: string,
    private readonly message: string,
    private readonly onConfirm: () => void,
  ) {
    super(app);
  }

  onOpen(): void {
    this.titleEl.setText(this.titleText);
    this.contentEl.createEl('p', { text: this.message });
    new Setting(this.contentEl)
      .addButton((button) => button.setButtonText('Cancel').onClick(() => this.close()))
      .addButton((button) => button
        .setButtonText('Confirm')
        .setWarning()
        .onClick(() => {
          this.close();
          this.onConfirm();
        }));
  }
}

export class TextPromptModal extends Modal {
  private value = '';

  constructor(
    app: App,
    private readonly titleText: string,
    private readonly initialValue: string,
    private readonly onSubmit: (value: string) => void,
  ) {
    super(app);
  }

  onOpen(): void {
    this.titleEl.setText(this.titleText);
    const input = this.contentEl.createEl('input', {
      type: 'text',
      value: this.initialValue,
      attr: { 'aria-label': this.titleText },
    });
    input.addClass('navsuite-prompt-input');
    this.value = this.initialValue;

    new Setting(this.contentEl)
      .addButton((button) => button.setButtonText('Cancel').onClick(() => this.close()))
      .addButton((button) => button
        .setCta()
        .setButtonText('Save')
        .onClick(() => {
          this.close();
          this.onSubmit(this.value);
        }));

    this.scope.register([], 'Enter', (event) => {
      event.preventDefault();
      this.close();
      this.onSubmit(this.value);
      return false;
    });
    input.addEventListener('input', () => { this.value = input.value; });
    window.setTimeout(() => {
      input.focus();
      input.select();
    }, 0);
  }
}
