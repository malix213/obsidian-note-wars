import { Modal, App, Setting, TAbstractFile, TFolder, FileSystemAdapter, Notice } from 'obsidian';
import * as path from 'path';

export interface AutoIncrementChoice {
    action: 'fill_gap' | 'append' | 'reincrement_all' | 'cancel';
    gapNumber?: number;
}

export class GapDetectionModal extends Modal {
    onChoice: (choice: AutoIncrementChoice) => void;
    gaps: number[];
    nextNumber: number;

    constructor(app: App, gaps: number[], nextNumber: number, onChoice: (choice: AutoIncrementChoice) => void) {
        super(app);
        this.gaps = gaps;
        this.nextNumber = nextNumber;
        this.onChoice = onChoice;
    }

    onOpen() {
        const { contentEl } = this;
        contentEl.createEl("h2", { text: "Gaps Detected in Numbering" });
        contentEl.createEl("p", { text: `Found missing numbers: ${this.gaps.join(', ')}` });
        contentEl.createEl("p", { text: `Next sequential number: ${this.nextNumber}` });

        const btnContainer = contentEl.createEl("div", { cls: "button-container" });
        btnContainer.setCssProps({
            "display": "flex",
            "justify-content": "flex-end",
            "gap": "10px",
            "margin-top": "20px"
        });

        new Setting(btnContainer)
            .addButton(btn => btn
                .setButtonText("Cancel")
                .onClick(() => {
                    this.onChoice({ action: 'cancel' });
                    this.close();
                }))
            .addButton(btn => btn
                .setButtonText("Reincrement All")
                .onClick(() => {
                    this.onChoice({ action: 'reincrement_all' });
                    this.close();
                }))
            .addButton(btn => btn
                .setButtonText(`Fill Gap (${this.gaps[0]})`)
                .onClick(() => {
                    this.onChoice({ action: 'fill_gap', gapNumber: this.gaps[0] });
                    this.close();
                }))
            .addButton(btn => btn
                .setButtonText(`Append (${this.nextNumber})`)
                .setCta()
                .onClick(() => {
                    this.onChoice({ action: 'append' });
                    this.close();
                }));
    }

    onClose() {
        this.contentEl.empty();
    }
}

export function parseNumberPrefix(name: string): number | null {
    const match = name.match(/^(\d+)\s-\s/);
    if (!match || !match[1]) return null;
    return parseInt(match[1], 10);
}

export async function handleAutoIncrement(app: App, file: TAbstractFile) {
    const parent = file.parent;
    if (!parent) return;

    const siblings = parent.children;
    const existingNumbers: number[] = [];

    siblings.forEach(sibling => {
        const num = parseNumberPrefix(sibling.name);
        if (num !== null) {
            existingNumbers.push(num);
        }
    });

    existingNumbers.sort((a, b) => a - b);

    const maxNumber = existingNumbers.length > 0 ? Math.max(...existingNumbers) : -1;
    const gaps: number[] = [];

    // Find gaps from 1 to maxNumber
    for (let i = 1; i <= maxNumber; i++) {
        if (!existingNumbers.includes(i)) {
            gaps.push(i);
        }
    }

    const nextNumber = maxNumber > 0 ? maxNumber + 1 : 1;

    if (gaps.length > 0) {
        new GapDetectionModal(app, gaps, nextNumber, async (choice) => {
            if (choice.action === 'cancel') return;
            if (choice.action === 'reincrement_all') {
                await handleReincrementAll(app, parent, file);
                return;
            }
            const targetNum = choice.action === 'fill_gap' ? (choice.gapNumber ?? 0) : nextNumber;
            await performRename(app, file, targetNum);
        }).open();
    } else {
        await performRename(app, file, nextNumber);
    }
}

export async function handleRemoveAutoIncrement(app: App, file: TAbstractFile) {
    const newName = file.name.replace(/^\d+\s-\s/, "");
    const newPath = path.join(file.parent?.path || "", newName);

    try {
        await app.fileManager.renameFile(file, newPath);
        new Notice(`Removed auto-increment: ${newName}`);
    } catch (e) {
        console.error("Failed to rename file:", e);
        new Notice("Failed to remove auto-increment numbering.");
    }
}

async function handleReincrementAll(app: App, folder: TFolder, selectedFile: TAbstractFile) {
    const children = [...folder.children];

    // Filter out files that already have prefixes and aren't the selected file
    const alreadyNumbered = children.filter(c =>
        c.path !== selectedFile.path && parseNumberPrefix(c.name) !== null
    );

    // Sort items by their current numeric prefix
    alreadyNumbered.sort((a, b) => {
        const numA = parseNumberPrefix(a.name) ?? Infinity;
        const numB = parseNumberPrefix(b.name) ?? Infinity;
        return numA - numB;
    });

    let currentIdx = 1;
    // Re-index all existing numbered files
    for (const child of alreadyNumbered) {
        const cleanName = child.name.replace(/^\d+\s-\s/, "");
        const prefix = currentIdx.toString().padStart(2, '0');
        const newName = `${prefix} - ${cleanName}`;

        if (child.name !== newName) {
            const newPath = path.join(folder.path, newName);
            try {
                await app.fileManager.renameFile(child, newPath);
            } catch (e) {
                console.error(`Failed to rename ${child.name} to ${newName}:`, e);
            }
        }
        currentIdx++;
    }

    // Finally, assign the LAST number to the selected file
    await performRename(app, selectedFile, currentIdx);

    new Notice("Reincremented all files successfully.");
}

async function performRename(app: App, file: TAbstractFile, num: number) {
    const prefix = num.toString().padStart(2, '0');
    const cleanName = file.name.replace(/^\d+\s-\s/, "");
    const newName = `${prefix} - ${cleanName}`;
    const newPath = path.join(file.parent?.path || "", newName);

    try {
        await app.fileManager.renameFile(file, newPath);
        new Notice(`Renamed to: ${newName}`);
    } catch (e) {
        console.error("Failed to rename file:", e);
        new Notice("Failed to set auto-increment numbering.");
    }
}
