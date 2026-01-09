import { TAbstractFile, Menu, App } from 'obsidian';
import { handleAutoIncrement, handleRemoveAutoIncrement } from './logic';

export function addAutoIncrementMenuItems(app: App, menu: Menu, file: TAbstractFile) {
    const name = file.name;
    const hasAutoIncrement = /^\d+\s-\s/.test(name);

    if (hasAutoIncrement) {
        menu.addItem((item) => {
            item
                .setTitle("Remove auto-increment")
                .setIcon("list-minus")
                .onClick(async () => {
                    await handleRemoveAutoIncrement(app, file);
                });
        });
    } else {
        menu.addItem((item) => {
            item
                .setTitle("Auto-increment")
                .setIcon("list-plus")
                .onClick(async () => {
                    await handleAutoIncrement(app, file);
                });
        });
    }
}
