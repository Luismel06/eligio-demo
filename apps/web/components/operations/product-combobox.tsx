'use client';

import { Check, ChevronDown, PackageSearch, Search } from 'lucide-react';
import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from 'react';
import { Input } from '@/components/ui/input';
import type { Product } from '@/lib/api';
import { cn } from '@/lib/utils';

export type ProductComboboxOptionState = {
  disabled: boolean;
  query: string;
  selected: boolean;
};

export type ProductComboboxResultsContext = {
  count: number;
  query: string;
  total: number;
};

export type ProductComboboxProps = {
  products: Product[];
  value: string;
  onValueChange: (productId: string) => void;
  disabledProductIds?: readonly string[];
  placeholder?: string;
  helperText?: ReactNode;
  resultsLabel?: (context: ProductComboboxResultsContext) => ReactNode;
  emptyResultsLabel?: ReactNode;
  getSearchText?: (product: Product) => string[];
  renderOption?: (product: Product, state: ProductComboboxOptionState) => ReactNode;
  disabled?: boolean;
  required?: boolean;
  id?: string;
  ariaLabel?: string;
  className?: string;
  inputClassName?: string;
  maxResults?: number;
};

function normalizeSearch(value: string) {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase();
}

function productSearchTerms(product: Product, getSearchText?: (product: Product) => string[]) {
  return [
    product.name,
    product.description,
    product.sku,
    product.barcode,
    ...(getSearchText?.(product) ?? []),
  ].filter((value): value is string => Boolean(value?.trim()));
}

function getProductMeta(product: Product) {
  return [
    product.sku ? `SKU ${product.sku}` : null,
    product.barcode ? `C\u00f3d. ${product.barcode}` : null,
  ]
    .filter(Boolean)
    .join(' \u00b7 ');
}

/**
 * Selector de productos con una sola superficie: al enfocarlo funciona como
 * buscador y muestra las coincidencias inmediatamente debajo del campo.
 */
export function ProductCombobox({
  products,
  value,
  onValueChange,
  disabledProductIds = [],
  placeholder = 'Buscar producto por nombre, SKU o c\u00f3digo',
  helperText,
  resultsLabel,
  emptyResultsLabel = 'No se encontraron productos con esa b\u00fasqueda.',
  getSearchText,
  renderOption,
  disabled = false,
  required = false,
  id,
  ariaLabel = 'Buscar y seleccionar producto',
  className,
  inputClassName,
  maxResults = 50,
}: ProductComboboxProps) {
  const generatedId = useId();
  const inputId = id ?? `product-combobox-${generatedId}`;
  const listboxId = `${inputId}-results`;
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const optionRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const [isOpen, setIsOpen] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(-1);

  const disabledIdsKey = disabledProductIds.join('|');
  const disabledIds = useMemo(() => new Set(disabledProductIds), [disabledIdsKey]);
  const selectedProduct = useMemo(
    () => products.find((product) => product.id === value) ?? null,
    [products, value],
  );
  const selectedLabel = selectedProduct?.name ?? '';
  const normalizedQuery = normalizeSearch(query.trim());

  const matchingProducts = useMemo(() => {
    const ranked = products
      .map((product, originalIndex) => {
        const terms = productSearchTerms(product, getSearchText);
        const normalizedTerms = terms.map(normalizeSearch);
        const exactMatch = normalizedTerms.some((term) => term === normalizedQuery);
        const startsWithMatch = normalizedTerms.some((term) => term.startsWith(normalizedQuery));
        const matches =
          !normalizedQuery || normalizedTerms.some((term) => term.includes(normalizedQuery));

        return { product, originalIndex, exactMatch, startsWithMatch, matches };
      })
      .filter((entry) => entry.matches)
      .sort((left, right) => {
        if (left.exactMatch !== right.exactMatch) {
          return left.exactMatch ? -1 : 1;
        }
        if (left.startsWithMatch !== right.startsWithMatch) {
          return left.startsWithMatch ? -1 : 1;
        }
        return (
          left.product.name.localeCompare(right.product.name, 'es') ||
          left.originalIndex - right.originalIndex
        );
      });

    return ranked.map((entry) => entry.product);
  }, [getSearchText, normalizedQuery, products]);

  const visibleProducts = useMemo(
    () => matchingProducts.slice(0, Math.max(1, maxResults)),
    [matchingProducts, maxResults],
  );
  const hasMoreResults = matchingProducts.length > visibleProducts.length;
  const inputValue = isEditing ? query : selectedLabel || query;
  const activeOptionId =
    activeIndex >= 0 && visibleProducts[activeIndex]
      ? `${listboxId}-option-${visibleProducts[activeIndex].id}`
      : undefined;

  useEffect(() => {
    const handlePointerDown = (event: PointerEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) {
        setIsOpen(false);
        setIsEditing(false);
      }
    };

    document.addEventListener('pointerdown', handlePointerDown);
    return () => document.removeEventListener('pointerdown', handlePointerDown);
  }, []);

  useEffect(() => {
    if (disabled) {
      setIsOpen(false);
      setIsEditing(false);
    }
  }, [disabled]);

  useEffect(() => {
    inputRef.current?.setCustomValidity(
      required && !value ? 'Selecciona un producto de la lista.' : '',
    );
  }, [required, value]);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    setActiveIndex((currentIndex) => {
      const current = visibleProducts[currentIndex];
      if (current && !disabledIds.has(current.id)) {
        return currentIndex;
      }
      return visibleProducts.findIndex((product) => !disabledIds.has(product.id));
    });
  }, [disabledIds, isOpen, visibleProducts]);

  useEffect(() => {
    if (activeIndex >= 0) {
      optionRefs.current[activeIndex]?.scrollIntoView({ block: 'nearest' });
    }
  }, [activeIndex]);

  function selectProduct(product: Product) {
    if (disabledIds.has(product.id)) {
      return;
    }

    onValueChange(product.id);
    setQuery('');
    setIsOpen(false);
    setIsEditing(false);
    setActiveIndex(-1);
  }

  function moveActiveOption(direction: 1 | -1) {
    if (!visibleProducts.length) {
      return;
    }

    const enabledIndexes = visibleProducts
      .map((product, index) => (!disabledIds.has(product.id) ? index : -1))
      .filter((index) => index >= 0);
    if (!enabledIndexes.length) {
      return;
    }

    const currentEnabledPosition = enabledIndexes.indexOf(activeIndex);
    const nextPosition =
      currentEnabledPosition < 0
        ? direction > 0
          ? 0
          : enabledIndexes.length - 1
        : (currentEnabledPosition + direction + enabledIndexes.length) % enabledIndexes.length;
    setActiveIndex(enabledIndexes[nextPosition]);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setIsOpen(true);
      moveActiveOption(1);
      return;
    }

    if (event.key === 'ArrowUp') {
      event.preventDefault();
      setIsOpen(true);
      moveActiveOption(-1);
      return;
    }

    if (event.key === 'Escape') {
      event.preventDefault();
      setIsOpen(false);
      setIsEditing(false);
      setActiveIndex(-1);
      return;
    }

    if (event.key === 'Enter' && isOpen) {
      event.preventDefault();
      const activeProduct = visibleProducts[activeIndex];
      if (activeProduct && !disabledIds.has(activeProduct.id)) {
        selectProduct(activeProduct);
      }
    }
  }

  const defaultResultsLabel = normalizedQuery
    ? `${matchingProducts.length} ${matchingProducts.length === 1 ? 'producto coincide' : 'productos coinciden'}.`
    : `${matchingProducts.length} ${matchingProducts.length === 1 ? 'producto disponible' : 'productos disponibles'}.`;
  const resultsHeader = resultsLabel?.({
    count: matchingProducts.length,
    query,
    total: products.length,
  });

  return (
    <div ref={containerRef} className={cn('relative', className)}>
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          ref={inputRef}
          id={inputId}
          role="combobox"
          aria-autocomplete="list"
          aria-controls={listboxId}
          aria-expanded={isOpen}
          aria-activedescendant={isOpen ? activeOptionId : undefined}
          aria-label={ariaLabel}
          value={inputValue}
          disabled={disabled}
          required={required}
          autoComplete="off"
          placeholder={placeholder}
          className={cn('bg-card pl-9 pr-9', inputClassName)}
          onFocus={() => {
            setIsOpen(true);
            setIsEditing(true);
            if (value) {
              setQuery('');
            }
          }}
          onBlur={() => {
            // El clic sobre una coincidencia evita el blur para que pueda
            // seleccionarse. Al navegar con Tab, en cambio, cerramos el panel.
            window.setTimeout(() => {
              if (!containerRef.current?.contains(document.activeElement)) {
                setIsOpen(false);
                setIsEditing(false);
              }
            }, 0);
          }}
          onChange={(event) => {
            if (value) {
              onValueChange('');
            }
            if (required) {
              event.currentTarget.setCustomValidity('Selecciona un producto de la lista.');
            }
            setQuery(event.target.value);
            setIsOpen(true);
          }}
          onKeyDown={handleKeyDown}
        />
        <ChevronDown
          aria-hidden="true"
          className={cn(
            'pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground transition-transform',
            isOpen && 'rotate-180',
          )}
        />
      </div>

      {isOpen ? (
        <div
          id={listboxId}
          role="listbox"
          aria-label="Resultados de productos"
          className="absolute z-30 mt-2 w-full overflow-hidden rounded-lg border border-border bg-card shadow-lg"
        >
          <div className="flex items-center justify-between gap-3 border-b border-border/70 px-3 py-2 text-xs text-muted-foreground">
            <span className="truncate">{resultsHeader ?? defaultResultsLabel}</span>
            {hasMoreResults ? <span className="shrink-0">{'Refina la b\u00fasqueda'}</span> : null}
          </div>
          {visibleProducts.length ? (
            <div className="surface-scrollbar max-h-64 overflow-y-auto p-1">
              {visibleProducts.map((product, index) => {
                const optionDisabled = disabledIds.has(product.id);
                const optionSelected = product.id === value;
                const optionContent = renderOption?.(product, {
                  disabled: optionDisabled,
                  query,
                  selected: optionSelected,
                });

                return (
                  <button
                    key={product.id}
                    ref={(node) => {
                      optionRefs.current[index] = node;
                    }}
                    id={`${listboxId}-option-${product.id}`}
                    type="button"
                    role="option"
                    aria-selected={optionSelected}
                    aria-disabled={optionDisabled || undefined}
                    disabled={optionDisabled}
                    className={cn(
                      'flex w-full items-center gap-3 rounded-md px-3 py-2.5 text-left transition-colors focus-visible:bg-muted focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-45',
                      activeIndex === index || optionSelected ? 'bg-muted' : 'hover:bg-muted/70',
                    )}
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => selectProduct(product)}
                  >
                    {optionContent ?? (
                      <>
                        <span className="flex min-w-0 flex-1 items-center gap-2">
                          <span className="min-w-0">
                            <span className="block truncate text-sm font-medium">
                              {product.name}
                            </span>
                            <span className="block truncate text-xs text-muted-foreground">
                              {getProductMeta(product) ||
                                product.description ||
                                'Sin c\u00f3digo registrado'}
                            </span>
                          </span>
                        </span>
                        {optionSelected ? (
                          <Check
                            className="h-4 w-4 shrink-0 text-primary"
                            aria-label="Seleccionado"
                          />
                        ) : optionDisabled ? (
                          <span className="shrink-0 text-xs text-muted-foreground">
                            Ya agregado
                          </span>
                        ) : null}
                      </>
                    )}
                  </button>
                );
              })}
            </div>
          ) : (
            <div className="flex items-center gap-2 px-3 py-4 text-sm text-muted-foreground">
              <PackageSearch className="h-4 w-4 shrink-0" />
              <span>{emptyResultsLabel}</span>
            </div>
          )}
        </div>
      ) : null}

      {helperText ? (
        <p className="mt-2 text-xs leading-5 text-muted-foreground">{helperText}</p>
      ) : null}
    </div>
  );
}
