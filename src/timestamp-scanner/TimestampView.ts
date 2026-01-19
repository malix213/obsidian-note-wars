import { ItemView, WorkspaceLeaf, Notice, TFile, MarkdownView, Plugin } from "obsidian";
import { TimestampMatch } from "./scanner";

export const TIMESTAMP_VIEW_TYPE = "timestamp-view";

export class TimestampView extends ItemView {
	private timestamps: TimestampMatch[] = [];
	private file: TFile | null = null;
	private readonly plugin: Plugin;

	constructor(leaf: WorkspaceLeaf, plugin: Plugin) {
		super(leaf);
		this.plugin = plugin;
	}

	getViewType(): string {
		return TIMESTAMP_VIEW_TYPE;
	}

	getDisplayText(): string {
		return "Timestamps";
	}

	getIcon(): string {
		return "scan-line"; // Or any other suitable icon
	}

	async onOpen() {
		await super.onOpen();
		const contentEl = this.contentEl;
		contentEl.empty();
		contentEl.createEl("h2", { text: "Timestamps found" });

		// Add a placeholder for the timestamp list
		this.contentEl.createDiv({ cls: "timestamp-list", attr: { id: "timestamp-list-container" } });
	}

	async onClose() {
		// Cleanup logic if needed
	}

	/**
	 * Updates the view with new timestamp data.
	 * @param timestamps - An array of TimestampMatch objects.
	 * @param file - The TFile associated with the timestamps.
	 */
	public setTimestamps(timestamps: TimestampMatch[], file: TFile) {
		this.timestamps = timestamps;
		this.file = file;
		this.renderTimestamps();
	}

	private renderTimestamps() {
		const container = this.contentEl.querySelector("#timestamp-list-container") as HTMLElement;
		if (!container) {
			console.error("Timestamp list container not found.");
			return;
		}
		container.empty();

		// Add count header
		const countHeader = container.createEl("div", { cls: "timestamp-count-header" });
		countHeader.createEl("span", {
			text: `${this.timestamps.length} timestamp${this.timestamps.length !== 1 ? 's' : ''} found`,
			cls: "timestamp-count-text"
		});

		if (this.timestamps.length === 0) {
			return;
		}

		// Create a container for timestamp cards (no bullet points)
		const cardsContainer = container.createEl("div", { cls: "timestamp-cards-container" });

		for (const tsMatch of this.timestamps) {
			// Create card/rectangle for each timestamp
			const card = cardsContainer.createEl("div", { cls: "timestamp-card" });

			// Header section with badges
			const header = card.createEl("div", { cls: "timestamp-card-header" });

			// Badge for timestamp type (Timestamp or Time Slot)
			header.createEl("span", {
				cls: tsMatch.isTimeSlot ? "timestamp-badge timestamp-badge-slot" : "timestamp-badge timestamp-badge-time",
				text: tsMatch.isTimeSlot ? "Time slot" : "Timestamp"
			});

			// Badge for line number
			header.createEl("span", {
				cls: "timestamp-badge timestamp-badge-line",
				text: `Line ${tsMatch.lineNumber}`
			});

			// Timestamp text (clickable)
			card.createEl("div", {
				cls: "timestamp-card-time",
				text: tsMatch.text
			});

			// Line content preview
			card.createEl("div", {
				cls: "timestamp-card-preview",
				text: tsMatch.lineContent.trim()
			});

			// Make the entire card clickable
			card.onclick = async () => {
				await this.jumpToTimestamp(tsMatch);
			};

			// Add hover effect class
			card.addClass("timestamp-card-clickable");
		}
	}

	/**
	 * Jumps the editor cursor to the specified timestamp's location.
	 * @param tsMatch - The TimestampMatch object.
	 */
	private async jumpToTimestamp(tsMatch: TimestampMatch) {
		if (!this.file) {
			new Notice("Cannot jump: no file is associated with this view.");
			return;
		}

		try {
			// Open the file first (or focus it if already open)
			const leaf = this.app.workspace.getLeaf(false);
			await leaf.openFile(this.file);

			// Wait a moment for the editor to be ready
			await new Promise(resolve => setTimeout(resolve, 50));

			// Get the markdown view after opening the file
			const markdownView = this.app.workspace.getActiveViewOfType(MarkdownView);
			if (!markdownView || !markdownView.editor) {
				new Notice("Cannot jump: no active editor found");
				return;
			}

			const editor = markdownView.editor;

			// Set cursor position (line numbers are 1-based in our data, 0-based in editor)
			const lineIndex = tsMatch.lineNumber - 1;
			editor.setCursor({ line: lineIndex, ch: tsMatch.startChar });

			// Scroll the timestamp into view
			editor.scrollIntoView({
				from: { line: lineIndex, ch: tsMatch.startChar },
				to: { line: lineIndex, ch: tsMatch.endChar },
			}, true);

			// Focus the editor
			editor.focus();
		} catch (error) {
			console.error("Failed to jump to timestamp:", error);
			new Notice("Failed to navigate to timestamp");
		}
	}
}
