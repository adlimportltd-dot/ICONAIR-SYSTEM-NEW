import type { ReactNode, InputHTMLAttributes, TextareaHTMLAttributes, SelectHTMLAttributes, ButtonHTMLAttributes } from 'react';

export function Field(props: { label: ReactNode; hint?: ReactNode; error?: ReactNode; children?: ReactNode; required?: boolean }): JSX.Element;
export function TextInput(props: InputHTMLAttributes<HTMLInputElement>): JSX.Element;
export function TextArea(props: TextareaHTMLAttributes<HTMLTextAreaElement>): JSX.Element;
export function Select(props: SelectHTMLAttributes<HTMLSelectElement> & { options?: { value: string; label: string }[]; placeholder?: string }): JSX.Element;
export function PrimaryButton(props: ButtonHTMLAttributes<HTMLButtonElement> & { loading?: boolean }): JSX.Element;
export function SecondaryButton(props: ButtonHTMLAttributes<HTMLButtonElement>): JSX.Element;
