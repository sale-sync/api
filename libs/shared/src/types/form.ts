// libs/shared/src/types/form.ts

export type ISingleLineText = {
    id: string;
    label: string;
    type: 'single-line';
};

export type IMultiLineText = {
    id: string;
    label: string;
    type: 'multi-line';
    height?: string | number;
};

export type ISelect = {
    id: string;
    label: string;
    type: 'select';
    options: {
        value: string;
        label: string;
    }[];
};

export type IFormField = ISingleLineText | IMultiLineText | ISelect;

export type IFormObj = {
    id: string; // uuid
    name: string;
    fields: IFormField[];
};
