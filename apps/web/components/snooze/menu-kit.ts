// The dropdown menu and the right-click menu are two sets of stock shadcn parts with the same shape. A kit names one set, so
// the snooze and label items are written once and drawn in either (the header's More menu, a row's context menu).

import type { ElementType } from "react";
import { ContextMenuCheckboxItem, ContextMenuItem, ContextMenuSeparator, ContextMenuSub, ContextMenuSubContent, ContextMenuSubTrigger } from "@/components/ui/context-menu";
import { DropdownMenuCheckboxItem, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuSub, DropdownMenuSubContent, DropdownMenuSubTrigger } from "@/components/ui/dropdown-menu";

export interface MenuKit {
  Item: ElementType;
  CheckboxItem: ElementType;
  Separator: ElementType;
  Sub: ElementType;
  SubTrigger: ElementType;
  SubContent: ElementType;
}

export const DROPDOWN_KIT: MenuKit = { Item: DropdownMenuItem, CheckboxItem: DropdownMenuCheckboxItem, Separator: DropdownMenuSeparator, Sub: DropdownMenuSub, SubTrigger: DropdownMenuSubTrigger, SubContent: DropdownMenuSubContent };
export const CONTEXT_KIT: MenuKit = { Item: ContextMenuItem, CheckboxItem: ContextMenuCheckboxItem, Separator: ContextMenuSeparator, Sub: ContextMenuSub, SubTrigger: ContextMenuSubTrigger, SubContent: ContextMenuSubContent };
