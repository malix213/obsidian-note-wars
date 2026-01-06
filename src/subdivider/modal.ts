
import {
    type App, Modal, Setting
} from 'obsidian'

export class FilenameModal extends Modal {

    constructor(app: App,) {
        super(app)
    }
    private filename: string
    resolve: ((value: string | PromiseLike<string>) => void) | null = null
    myOpen() {
        this.open()
        return new Promise((resolve) => {
            this.resolve = resolve
        })
    }

    onOpen() {
        const { contentEl, titleEl } = this
        titleEl.setText("Pick a name:")
        new Setting(contentEl)
            .setName("Name")
            .addText((text) =>
                text.onChange((value) => {
                    this.filename = value
                }))

        new Setting(contentEl)
            .addButton((btn) =>
                btn
                    .setButtonText("Confirm")
                    .setCta()
                    .onClick(() => {
                        if (this.resolve) this.resolve(this.filename)
                        this.close()
                    }))
    }

    onClose() {
        const { contentEl } = this
        contentEl.empty()
    }
}

export class OverrideModal extends Modal {
    constructor(
        app: App,
        private readonly name: string,
        private readonly isFolder: boolean
    ) {
        super(app)
    }
    resolve: ((value: boolean | PromiseLike<boolean>) => void) | null = null
    myOpen() {
        this.open()
        return new Promise((resolve) => {
            this.resolve = resolve
        })
    }
    onOpen() {
        const { contentEl, titleEl } = this
        if (this.isFolder) {
            titleEl.setText("Override folder")
            contentEl
                .createEl("p")
                .setText(
                    `The folder ${this.name} already exists. Do you want to override it?`
                )
        }
        else {
            titleEl.setText("Override file")
            contentEl
                .createEl("p")
                .setText(
                    `The file ${this.name} already exists. Do you want to override it?`
                )

        }

        const div = contentEl.createDiv({ cls: "modal-button-container" })
        const discard = div.createEl("button", {
            cls: "mod-warning",
            text: "Override",
        })
        discard.addEventListener("click", () => {
            if (this.resolve) this.resolve(true)
            this.close()
        })
        discard.addEventListener("keypress", () => {
            if (this.resolve) this.resolve(true)
            this.close()
        })

        const close = div.createEl("button", {
            text: "Cancel",
        })
        close.addEventListener("click", () => {
            if (this.resolve) this.resolve(false)
            return this.close()
        })
        close.addEventListener("keypress", () => {
            if (this.resolve) this.resolve(false)
            return this.close()
        })
    }

    onClose() {
        const { contentEl } = this
        contentEl.empty()
    }
}

export class HeadersModal extends Modal {
    private proposedHeaders: string[]
    private originalHeaders: string[]
    private listEl: HTMLElement
    private autoIncrement: boolean
    private editable = true

    constructor(
        app: App,
        headers: string[],
        autoIncrement: boolean
    ) {
        super(app)
        this.autoIncrement = autoIncrement
        this.originalHeaders = [...headers]
        this.proposedHeaders = headers.map(h =>
            h.replace(/[^\p{L}\p{N}\s]/gu, ' ')
                .replace(/\s+/g, ' ')
                .trim()
        )
        if (this.autoIncrement) {
            this.proposedHeaders = this.proposedHeaders.map((h, i) =>
                (i + 1).toString().padStart(3, '0') + " - " + h
            )
        }
    }

    resolve: ((value: string[] | null) => void) | null = null

    myOpen(): Promise<string[] | null> {
        this.open()
        return new Promise((resolve) => {
            this.resolve = resolve
        })
    }

    private renderHeaders() {
        this.listEl.empty()
        this.originalHeaders.forEach((header, index) => {
            const proposed = this.proposedHeaders[index]
            const item = this.listEl.createEl("li")
            item.setCssProps({
                "margin-bottom": "12px",
                "list-style": "none",
                "border-bottom": "1px solid var(--background-modifier-border)",
                "padding-bottom": "8px"
            })

            const originalDiv = item.createDiv({ cls: "header-original" })
            originalDiv.setText(`Original: ${header}`)
            originalDiv.setCssProps({
                "font-size": "0.8em",
                "color": "var(--text-muted)",
                "margin-bottom": "4px"
            })

            const proposedContainer = item.createDiv({ cls: "header-proposed-container" })
            proposedContainer.setCssProps({
                "display": "flex",
                "align-items": "center",
                "gap": "8px"
            })

            const label = proposedContainer.createSpan({ text: "File Name:" })
            label.setCssProps({
                "font-weight": "bold",
                "white-space": "nowrap"
            })

            if (this.editable) {
                const input = proposedContainer.createEl("input", {
                    type: "text",
                    value: proposed,
                })
                input.setCssProps({ "width": "100%" })

                input.addEventListener("input", (e) => {
                    this.proposedHeaders[index] = (e.target as HTMLInputElement).value
                })
            } else {
                const span = proposedContainer.createSpan({ text: proposed })
                span.setCssProps({ "color": "var(--text-accent)" })
            }
        })
    }

    onOpen() {
        const { contentEl, titleEl } = this
        titleEl.setText("Verify proposed names")

        new Setting(contentEl)
            .setName("Auto increment")
            .setDesc("Add numeric prefixes to filenames.")
            .addToggle(toggle => toggle
                .setValue(this.autoIncrement)
                .onChange(value => {
                    this.autoIncrement = value
                    if (value) {
                        this.proposedHeaders = this.proposedHeaders.map((h, i) =>
                            (i + 1).toString().padStart(3, '0') + " - " + h.replace(/^\d+ - /, "")
                        )
                    } else {
                        this.proposedHeaders = this.proposedHeaders.map(h => h.replace(/^\d+ - /, ""))
                    }
                    this.renderHeaders()
                }))

        new Setting(contentEl)
            .setName("Edit names")
            .setDesc("Toggle between editable inputs and plain text")
            .addToggle(toggle => toggle
                .setValue(this.editable)
                .onChange(value => {
                    this.editable = value
                    this.renderHeaders()
                }))

        contentEl.createEl("p").setText("Review the proposed filenames for the new sections:")

        this.listEl = contentEl.createEl("ul")
        this.renderHeaders()

        const div = contentEl.createDiv({ cls: "modal-button-container" })

        const confirm = div.createEl("button", {
            cls: "mod-cta",
            text: "Confirm & subdivide",
        })
        confirm.addEventListener("click", () => {
            if (this.resolve) this.resolve(this.proposedHeaders)
            this.close()
        })

        const close = div.createEl("button", {
            text: "Cancel",
        })
        close.addEventListener("click", () => {
            if (this.resolve) this.resolve(null)
            this.close()
        })
    }

    onClose() {
        const { contentEl } = this
        contentEl.empty()
    }
}
