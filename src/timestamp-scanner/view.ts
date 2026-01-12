import { ItemView, WorkspaceLeaf, TFile, MarkdownView } from "obsidian";
import { TimestampMatch, goToTimestampLine } from "./scanner";

export const VIEW_TYPE_TIMESTAMP_SCANNER = "timestamp-scanner-view";

export class TimestampScannerView extends ItemView {
    matches: TimestampMatch[] = [];
    currentFile: TFile | null = null;

    constructor(leaf: WorkspaceLeaf) {
        super(leaf);
    }

    getViewType() {
        return VIEW_TYPE_TIMESTAMP_SCANNER;
    }

    getDisplayText() {
        return "Timestamp scanner";
    }

    getIcon() {
        return "clock";
    }

    async onOpen() {
        this.render();
    }

    async onClose() {
        // Nothing to clean up
    }

    public setMatches(matches: TimestampMatch[], file: TFile) {
        this.matches = matches;
        this.currentFile = file;
        this.render();
    }

    private render() {
        const container = this.contentEl;
        container.empty();
        container.addClass("timestamp-scanner-container");

        const header = container.createEl("div", { cls: "timestamp-scanner-header" });
        header.createEl("h4", { text: "Scanned timestamps" });

        if (this.currentFile) {
            header.createEl("div", {
                text: `Source: ${this.currentFile.name}`,
                cls: "timestamp-scanner-source"
            });
        }

        if (this.matches.length === 0) {
            container.createEl("p", { text: "No timestamps found or scan a note to start.", cls: "timestamp-scanner-empty" });
            return;
        }

        const list = container.createEl("div", { cls: "timestamp-scanner-list" });

        this.matches.forEach((match) => {
            const item = list.createEl("div", { cls: "timestamp-scanner-item" });

            item.createEl("div", {
                text: match.text,
                cls: "timestamp-scanner-time"
            });

            item.createEl("div", {
                text: match.lineContent,
                cls: "timestamp-scanner-preview"
            });

            item.onClickEvent(() => {
                this.navigateToMatch(match);
            });
        });
    }

    private navigateToMatch(match: TimestampMatch) {
        const { workspace } = this.app;

        // Find the leaf containing the file
        const leaves = workspace.getLeavesOfType("markdown");
        const targetLeaf = leaves.find(leaf => {
            const view = leaf.view as MarkdownView;
            return view.file?.path === this.currentFile?.path;
        });

        if (targetLeaf) {
            workspace.setActiveLeaf(targetLeaf, { focus: true });
            const editor = (targetLeaf.view as MarkdownView).editor;
            goToTimestampLine(editor, match.lineNumber);
        }
    }
}
