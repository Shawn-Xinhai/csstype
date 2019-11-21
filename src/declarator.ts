import { getAtRules } from './collections/at-rules';
import { getHtmlAttributes, getSvgAttributes } from './collections/attributes';
import { getDataTypesOf } from './collections/data-types';
import { getGlobals, getHtmlProperties, getSvgProperties, isVendorProperty } from './collections/properties';
import { getPseudos } from './collections/selectors';
import { IDataType, Type, TypeType } from './syntax/typer';
import { toCamelCase, toPascalCase, toVendorPrefixCase } from './utils/casing';

export interface IAlias {
  type: Type.Alias;
  name: string;
  generics: IGenerics[];
  namespace: INamespace | undefined;
}

export interface IGenerics {
  name: string;
  defaults?: SimpleType[];
  extend?: string;
}

export type Interface = IInterfaceProperties | IInterfaceFallback;

interface IInterfaceProperties {
  name: string;
  generics: IGenerics[];
  extends: Interface[];
  export: boolean;
  properties: PropertyType[];
}

interface IInterfaceFallback {
  name: string;
  generics: IGenerics[];
  export: boolean;
  fallbacks: IInterfaceProperties;
}

export function isInterface(value: Interface | IDeclaration): value is Interface {
  return !!(value as IInterfaceProperties).properties || !!(value as IInterfaceFallback).fallbacks;
}

export function isInterfaceProperties(value: Interface): value is IInterfaceProperties {
  return !!(value as IInterfaceProperties).properties;
}

interface IPropertyAlias {
  name: string;
  generics: IGenerics[];
  alias: IAlias;
  comment: () => Promise<string | undefined>;
  namespace: INamespace | undefined;
}

interface IPropertyType {
  name: string;
  type: DeclarableType;
  comment: () => Promise<string | undefined>;
}

type PropertyType = IPropertyAlias | IPropertyType;

type MixedType = TypeType<IDataType<Type.DataType> | IAlias>;
export type DeclarableType = TypeType<IAlias>;
export type SimpleType = Exclude<DeclarableType, IAlias>;

export interface INamespace {
  name: string;
  export: boolean;
  body: () => Array<Interface | IDeclaration>;
}

export interface IDeclaration {
  name: string;
  export: boolean;
  types: DeclarableType[];
  generics: IGenerics[];
  namespace: INamespace | undefined;
}

const lengthGeneric: IGenerics = {
  name: 'TLength',
  defaults: [{ type: Type.String }, { type: Type.NumericLiteral, literal: 0 }],
};

export async function declarator(minTypesInDataTypes: number) {
  const [
    dataTypes,
    [htmlProperties, svgProperties, atRules, globals, pseudos, htmlAttributes, svgAttributes],
  ] = await getDataTypesOf(dictionary =>
    Promise.all([
      getHtmlProperties(dictionary, minTypesInDataTypes),
      getSvgProperties(dictionary, minTypesInDataTypes),
      getAtRules(dictionary, minTypesInDataTypes),
      getGlobals(dictionary, minTypesInDataTypes),
      getPseudos(),
      getHtmlAttributes(),
      getSvgAttributes(),
    ]),
  );

  function lengthIn(types: MixedType[]): boolean {
    return !types.every(type => {
      switch (type.type) {
        case Type.Length:
          return false;
        case Type.DataType:
          return !(type.name in dataTypes && lengthIn(dataTypes[type.name]));
        default:
          return true;
      }
    });
  }

  function alias(name: string, types?: MixedType[], namespace?: INamespace): IAlias {
    return {
      type: Type.Alias,
      name,
      generics: types && lengthIn(types) ? [lengthGeneric] : [],
      namespace,
    };
  }

  function aliasOf({ name, types, namespace }: IDeclaration): IAlias {
    return alias(name, types, namespace);
  }

  function declarable(types: MixedType[]): DeclarableType[] {
    return types.sort(sorter).map<DeclarableType>(type => {
      switch (type.type) {
        case Type.DataType:
          return type.name in dataTypes
            ? alias(toPascalCase(type.name), dataTypes[type.name], dataTypeNamespace)
            : alias(toPascalCase(type.name));
        default:
          return type;
      }
    });
  }

  const globalDeclarations: Map<MixedType[], IDeclaration> = new Map();

  function declarationNameExists(
    map: Map<Array<TypeType<IDataType<Type.DataType> | IAlias>>, IDeclaration>,
    name: string,
  ) {
    for (const declaration of map.values()) {
      if (declaration.name === name) {
        return true;
      }
    }

    return false;
  }

  const atRuleDeclaration: IDeclaration = {
    name: 'AtRules',
    export: true,
    types: declarable(atRules.literals),
    generics: [],
    namespace: undefined,
  };

  globalDeclarations.set(atRules.literals, atRuleDeclaration);

  const advancedPseudosDeclaration: IDeclaration = {
    name: 'AdvancedPseudos',
    export: true,
    types: declarable(pseudos.advanced),
    generics: [],
    namespace: undefined,
  };

  globalDeclarations.set(pseudos.advanced, advancedPseudosDeclaration);

  const simplePseudosDeclaration: IDeclaration = {
    name: 'SimplePseudos',
    export: true,
    types: declarable(pseudos.simple),
    generics: [],
    namespace: undefined,
  };

  globalDeclarations.set(pseudos.simple, simplePseudosDeclaration);

  const pseudoAliases = [aliasOf(advancedPseudosDeclaration), aliasOf(simplePseudosDeclaration)];

  const pseudosDeclaration: IDeclaration = {
    name: 'Pseudos',
    export: true,
    types: pseudoAliases,
    generics: [],
    namespace: undefined,
  };

  globalDeclarations.set(pseudoAliases, pseudosDeclaration);

  const htmlAttributesDeclaration: IDeclaration = {
    name: 'HtmlAttributes',
    export: true,
    types: declarable(htmlAttributes),
    generics: [],
    namespace: undefined,
  };

  globalDeclarations.set(htmlAttributes, htmlAttributesDeclaration);

  const svgAttributesDeclaration: IDeclaration = {
    name: 'SvgAttributes',
    export: true,
    types: declarable(svgAttributes),
    generics: [],
    namespace: undefined,
  };

  globalDeclarations.set(svgAttributes, svgAttributesDeclaration);

  const globalsDeclaration: IDeclaration = {
    name: 'Globals',
    export: true,
    types: declarable(globals),
    generics: [],
    namespace: undefined,
  };

  globalDeclarations.set(globals, globalsDeclaration);

  const standardLonghandPropertiesDefinition: IPropertyAlias[] = [];
  const standardShorthandPropertiesDefinition: IPropertyAlias[] = [];
  const standardLonghandPropertiesHyphenDefinition: IPropertyAlias[] = [];
  const standardShorthandPropertiesHyphenDefinition: IPropertyAlias[] = [];
  const vendorLonghandPropertiesDefinition: IPropertyAlias[] = [];
  const vendorShorthandPropertiesDefinition: IPropertyAlias[] = [];
  const vendorLonghandPropertiesHyphenDefinition: IPropertyAlias[] = [];
  const vendorShorthandPropertiesHyphenDefinition: IPropertyAlias[] = [];
  const obsoletePropertiesDefinition: IPropertyAlias[] = [];
  const obsoletePropertiesHyphenDefinition: IPropertyAlias[] = [];
  const svgPropertiesDefinition: IPropertyAlias[] = [];
  const svgPropertiesHyphenDefinition: IPropertyAlias[] = [];

  const propertyDeclarations: Map<MixedType[], IDeclaration> = new Map();
  const dataTypeDeclarations: Map<MixedType[], IDeclaration> = new Map();

  const propertyNamespace: INamespace = {
    name: 'Property',
    export: true,
    body: () => Array.from(propertyDeclarations.values()),
  };
  const dataTypeNamespace: INamespace = {
    name: 'DataType',
    export: false,
    body: () => Array.from(dataTypeDeclarations.values()),
  };

  function toPropertyDeclarationName(name: string) {
    return toPascalCase(name);
  }

  for (const properties of [htmlProperties, svgProperties]) {
    // Sort alphabetical, starting with standard properties
    const propertyNames = ([] as string[]).concat(
      Object.keys(properties)
        .filter(name => name[0] !== '-')
        .sort(),
      Object.keys(properties)
        .filter(name => name[0] === '-')
        .sort(),
    );

    for (const name of propertyNames) {
      const property = properties[name];
      let definitions: IPropertyAlias[];
      let hyphenDefinitions: IPropertyAlias[];

      if (properties === svgProperties) {
        definitions = svgPropertiesDefinition;
        hyphenDefinitions = svgPropertiesHyphenDefinition;
      } else if (property.obsolete) {
        definitions = obsoletePropertiesDefinition;
        hyphenDefinitions = obsoletePropertiesHyphenDefinition;
      } else if (property.vendor) {
        if (property.shorthand) {
          definitions = vendorShorthandPropertiesDefinition;
          hyphenDefinitions = vendorShorthandPropertiesHyphenDefinition;
        } else {
          definitions = vendorLonghandPropertiesDefinition;
          hyphenDefinitions = vendorLonghandPropertiesHyphenDefinition;
        }
      } else {
        if (property.shorthand) {
          definitions = standardShorthandPropertiesDefinition;
          hyphenDefinitions = standardShorthandPropertiesHyphenDefinition;
        } else {
          definitions = standardLonghandPropertiesDefinition;
          hyphenDefinitions = standardLonghandPropertiesHyphenDefinition;
        }
      }

      const generics = lengthIn(property.types) ? [lengthGeneric] : [];

      // Some properties are prefixed and share the same type so we
      // make sure to reuse the same declaration of that type
      let declaration = propertyDeclarations.get(property.types);

      if (!declaration) {
        const declarationName = toPropertyDeclarationName(property.name);

        declaration = {
          name: declarationName,
          export: true,
          types: [aliasOf(globalsDeclaration), ...declarable(property.types)],
          generics,
          namespace: propertyNamespace,
        };

        // Some SVG properties are shared with regular style properties
        // and we assume here that they are identical
        if (!declarationNameExists(propertyDeclarations, declarationName)) {
          propertyDeclarations.set(property.types, declaration);
        }
      }

      definitions.push({
        name: property.vendor ? toVendorPrefixCase(name) : toCamelCase(name),
        generics,
        alias: aliasOf(declaration),
        comment: property.comment,
        namespace: declaration.namespace,
      });
      hyphenDefinitions.push({
        name,
        generics,
        alias: aliasOf(declaration),
        comment: property.comment,
        namespace: declaration.namespace,
      });
    }
  }

  const atRuleDefinitions: { [name: string]: PropertyType[] } = {};
  const atRuleHyphenDefinitions: { [name: string]: PropertyType[] } = {};
  const atRuleDeclarations: Map<MixedType[], IDeclaration> = new Map();
  const atRuleInterfaces: Interface[] = [];
  const atRuleNamespace: INamespace = {
    name: 'AtRule',
    export: true,
    body: () => [...atRuleInterfaces, ...Array.from(atRuleDeclarations.values())],
  };

  for (const name of Object.keys(atRules.rules).sort()) {
    atRuleDefinitions[name] = [];
    atRuleHyphenDefinitions[name] = [];

    for (const property of Object.keys(atRules.rules[name]).sort()) {
      const descriptor = atRules.rules[name][property];
      const types = descriptor.types;
      const generics = lengthIn(types) ? [lengthGeneric] : [];

      if (onlyContainsString(types) || onlyContainsNumber(types)) {
        const type: DeclarableType = {
          type: onlyContainsString(types) ? Type.String : Type.Number,
        };

        atRuleDefinitions[name].push({
          name: isVendorProperty(property) ? toVendorPrefixCase(property) : toCamelCase(property),
          type,
          comment: () => Promise.resolve(undefined),
        });
        atRuleHyphenDefinitions[name].push({
          name: property,
          type,
          comment: () => Promise.resolve(undefined),
        });
      } else {
        // Some properties are prefixed and share the same type so we
        // make sure to reuse the same declaration of that type
        let declaration = atRuleDeclarations.get(types);

        if (!declaration) {
          declaration = {
            name: toPropertyDeclarationName(descriptor.name),
            export: false,
            types: declarable(types),
            generics,
            namespace: atRuleNamespace,
          };

          atRuleDeclarations.set(types, declaration);
        }

        atRuleDefinitions[name].push({
          name: isVendorProperty(property) ? toVendorPrefixCase(property) : toCamelCase(property),
          generics,
          alias: aliasOf(declaration),
          comment: () => Promise.resolve(undefined),
          namespace: atRuleNamespace,
        });
        atRuleHyphenDefinitions[name].push({
          name: property,
          generics,
          alias: aliasOf(declaration),
          comment: () => Promise.resolve(undefined),
          namespace: atRuleNamespace,
        });
      }
    }
  }

  // Loop in alphabetical order
  for (const name of Object.keys(dataTypes).sort()) {
    const declarableDataType = declarable(dataTypes[name]);
    dataTypeDeclarations.set(declarableDataType, {
      name: toPascalCase(name),
      export: false,
      types: declarableDataType,
      generics: lengthIn(dataTypes[name]) ? [lengthGeneric] : [],
      namespace: dataTypeNamespace,
    });
  }

  const PROPERTIES = 'Properties';
  const LONGHAND = 'Longhand';
  const SHORTHAND = 'Shorthand';
  const STANDARD = 'Standard';
  const INTERFACE_STANDARD_LONGHAND_PROPERTIES = STANDARD + LONGHAND + PROPERTIES;
  const INTERFACE_STANDARD_SHORTHAND_PROPERTIES = STANDARD + SHORTHAND + PROPERTIES;
  const INTERFACE_STANDARD_PROPERTIES = STANDARD + PROPERTIES;
  const VENDOR = 'Vendor';
  const INTERFACE_VENDOR_LONGHAND_PROPERTIES = VENDOR + LONGHAND + PROPERTIES;
  const INTERFACE_VENDOR_SHORTHAND_PROPERTIES = VENDOR + SHORTHAND + PROPERTIES;
  const INTERFACE_VENDOR_PROPERTIES = VENDOR + PROPERTIES;
  const OBSOLETE = 'Obsolete';
  const INTERFACE_OBSOLETE_PROPERTIES = OBSOLETE + PROPERTIES;
  const SVG = 'Svg';
  const INTERFACE_SVG_PROPERTIES = SVG + PROPERTIES;
  const INTERFACE_ALL_PROPERTIES = PROPERTIES;
  const HYPHEN = 'Hyphen';
  const INTERFACE_STANDARD_LONGHAND_PROPERTIES_HYPHEN = INTERFACE_STANDARD_LONGHAND_PROPERTIES + HYPHEN;
  const INTERFACE_STANDARD_SHORTHAND_PROPERTIES_HYPHEN = INTERFACE_STANDARD_SHORTHAND_PROPERTIES + HYPHEN;
  const INTERFACE_STANDARD_PROPERTIES_HYPHEN = INTERFACE_STANDARD_PROPERTIES + HYPHEN;
  const INTERFACE_VENDOR_LONGHAND_PROPERTIES_HYPHEN = INTERFACE_VENDOR_LONGHAND_PROPERTIES + HYPHEN;
  const INTERFACE_VENDOR_SHORTHAND_PROPERTIES_HYPHEN = INTERFACE_VENDOR_SHORTHAND_PROPERTIES + HYPHEN;
  const INTERFACE_VENDOR_PROPERTIES_HYPHEN = INTERFACE_VENDOR_PROPERTIES + HYPHEN;
  const INTERFACE_OBSOLETE_PROPERTIES_HYPHEN = INTERFACE_OBSOLETE_PROPERTIES + HYPHEN;
  const INTERFACE_SVG_PROPERTIES_HYPHEN = INTERFACE_SVG_PROPERTIES + HYPHEN;
  const INTERFACE_ALL_PROPERTIES_HYPHEN = INTERFACE_ALL_PROPERTIES + HYPHEN;
  const FALLBACK = 'Fallback';
  const INTERFACE_STANDARD_LONGHAND_PROPERTIES_FALLBACK = INTERFACE_STANDARD_LONGHAND_PROPERTIES + FALLBACK;
  const INTERFACE_STANDARD_SHORTHAND_PROPERTIES_FALLBACK = INTERFACE_STANDARD_SHORTHAND_PROPERTIES + FALLBACK;
  const INTERFACE_STANDARD_PROPERTIES_FALLBACK = INTERFACE_STANDARD_PROPERTIES + FALLBACK;
  const INTERFACE_VENDOR_LONGHAND_PROPERTIES_FALLBACK = INTERFACE_VENDOR_LONGHAND_PROPERTIES + FALLBACK;
  const INTERFACE_VENDOR_SHORTHAND_PROPERTIES_FALLBACK = INTERFACE_VENDOR_SHORTHAND_PROPERTIES + FALLBACK;
  const INTERFACE_VENDOR_PROPERTIES_FALLBACK = INTERFACE_VENDOR_PROPERTIES + FALLBACK;
  const INTERFACE_OBSOLETE_PROPERTIES_FALLBACK = INTERFACE_OBSOLETE_PROPERTIES + FALLBACK;
  const INTERFACE_SVG_PROPERTIES_FALLBACK = INTERFACE_SVG_PROPERTIES + FALLBACK;
  const INTERFACE_ALL_PROPERTIES_FALLBACK = INTERFACE_ALL_PROPERTIES + FALLBACK;
  const INTERFACE_STANDARD_LONGHAND_PROPERTIES_HYPHEN_FALLBACK =
    INTERFACE_STANDARD_LONGHAND_PROPERTIES + HYPHEN + FALLBACK;
  const INTERFACE_STANDARD_SHORTHAND_PROPERTIES_HYPHEN_FALLBACK =
    INTERFACE_STANDARD_SHORTHAND_PROPERTIES + HYPHEN + FALLBACK;
  const INTERFACE_STANDARD_PROPERTIES_HYPHEN_FALLBACK = INTERFACE_STANDARD_PROPERTIES + HYPHEN + FALLBACK;
  const INTERFACE_VENDOR_LONGHAND_PROPERTIES_HYPHEN_FALLBACK = INTERFACE_VENDOR_LONGHAND_PROPERTIES + HYPHEN + FALLBACK;
  const INTERFACE_VENDOR_SHORTHAND_PROPERTIES_HYPHEN_FALLBACK =
    INTERFACE_VENDOR_SHORTHAND_PROPERTIES + HYPHEN + FALLBACK;
  const INTERFACE_VENDOR_PROPERTIES_HYPHEN_FALLBACK = INTERFACE_VENDOR_PROPERTIES + HYPHEN + FALLBACK;
  const INTERFACE_OBSOLETE_PROPERTIES_HYPHEN_FALLBACK = INTERFACE_OBSOLETE_PROPERTIES + HYPHEN + FALLBACK;
  const INTERFACE_SVG_PROPERTIES_HYPHEN_FALLBACK = INTERFACE_SVG_PROPERTIES + HYPHEN + FALLBACK;
  const INTERFACE_ALL_PROPERTIES_HYPHEN_FALLBACK = INTERFACE_ALL_PROPERTIES + HYPHEN + FALLBACK;

  const standardLonghandPropertiesGenerics = genericsOf(standardLonghandPropertiesDefinition);
  const standardShorthandPropertiesGenerics = genericsOf(standardShorthandPropertiesDefinition);
  const standardPropertiesGenerics = genericsOf([
    ...standardLonghandPropertiesDefinition,
    ...standardShorthandPropertiesDefinition,
  ]);
  const vendorLonghandPropertiesGenerics = genericsOf(vendorLonghandPropertiesDefinition);
  const vendorShorthandPropertiesGenerics = genericsOf(vendorShorthandPropertiesDefinition);
  const vendorPropertiesGenerics = genericsOf([
    ...vendorLonghandPropertiesDefinition,
    ...vendorShorthandPropertiesDefinition,
  ]);
  const obsoletePropertiesGenerics = genericsOf(obsoletePropertiesDefinition);
  const svgPropertiesGenerics = genericsOf(svgPropertiesDefinition);
  const allPropertiesGenerics = genericsOf([
    ...standardLonghandPropertiesDefinition,
    ...standardShorthandPropertiesDefinition,
    ...vendorLonghandPropertiesDefinition,
    ...vendorShorthandPropertiesDefinition,
    ...obsoletePropertiesDefinition,
    ...svgPropertiesDefinition,
  ]);

  const standardLonghandPropertiesInterface: IInterfaceProperties = {
    name: INTERFACE_STANDARD_LONGHAND_PROPERTIES,
    generics: standardLonghandPropertiesGenerics,
    extends: [],
    export: true,
    properties: standardLonghandPropertiesDefinition,
  };

  const standardShorthandPropertiesInterface: IInterfaceProperties = {
    name: INTERFACE_STANDARD_SHORTHAND_PROPERTIES,
    generics: standardShorthandPropertiesGenerics,
    extends: [],
    export: true,
    properties: standardShorthandPropertiesDefinition,
  };

  const standardPropertiesInterface: IInterfaceProperties = {
    name: INTERFACE_STANDARD_PROPERTIES,
    generics: standardPropertiesGenerics,
    extends: [standardLonghandPropertiesInterface, standardShorthandPropertiesInterface],
    export: true,
    properties: [],
  };

  const vendorLonghandPropertiesInterface: IInterfaceProperties = {
    name: INTERFACE_VENDOR_LONGHAND_PROPERTIES,
    generics: vendorLonghandPropertiesGenerics,
    extends: [],
    export: true,
    properties: vendorLonghandPropertiesDefinition,
  };

  const vendorShorthandPropertiesInterface: IInterfaceProperties = {
    name: INTERFACE_VENDOR_SHORTHAND_PROPERTIES,
    generics: vendorShorthandPropertiesGenerics,
    extends: [],
    export: true,
    properties: vendorShorthandPropertiesDefinition,
  };

  const vendorPropertiesInterface: IInterfaceProperties = {
    name: INTERFACE_VENDOR_PROPERTIES,
    generics: vendorPropertiesGenerics,
    extends: [vendorLonghandPropertiesInterface, vendorShorthandPropertiesInterface],
    export: true,
    properties: [],
  };

  const obsoletePropertiesInterface: IInterfaceProperties = {
    name: INTERFACE_OBSOLETE_PROPERTIES,
    generics: obsoletePropertiesGenerics,
    extends: [],
    export: true,
    properties: obsoletePropertiesDefinition,
  };

  const svgPropertiesInterface: IInterfaceProperties = {
    name: INTERFACE_SVG_PROPERTIES,
    generics: svgPropertiesGenerics,
    extends: [],
    export: true,
    properties: svgPropertiesDefinition,
  };

  const allPropertiesInterface: IInterfaceProperties = {
    name: INTERFACE_ALL_PROPERTIES,
    generics: allPropertiesGenerics,
    extends: [
      standardPropertiesInterface,
      vendorPropertiesInterface,
      obsoletePropertiesInterface,
      svgPropertiesInterface,
    ],
    export: true,
    properties: [],
  };

  const standardLonghandPropertiesHyphenInterface: IInterfaceProperties = {
    name: INTERFACE_STANDARD_LONGHAND_PROPERTIES_HYPHEN,
    generics: standardLonghandPropertiesGenerics,
    extends: [],
    export: true,
    properties: standardLonghandPropertiesHyphenDefinition,
  };

  const standardShorthandPropertiesHyphenInterface: IInterfaceProperties = {
    name: INTERFACE_STANDARD_SHORTHAND_PROPERTIES_HYPHEN,
    generics: standardShorthandPropertiesGenerics,
    extends: [],
    export: true,
    properties: standardShorthandPropertiesHyphenDefinition,
  };

  const standardPropertiesHyphenInterface: IInterfaceProperties = {
    name: INTERFACE_STANDARD_PROPERTIES_HYPHEN,
    generics: standardPropertiesGenerics,
    extends: [standardLonghandPropertiesHyphenInterface, standardShorthandPropertiesHyphenInterface],
    export: true,
    properties: [],
  };

  const vendorLonghandPropertiesHyphenInterface: IInterfaceProperties = {
    name: INTERFACE_VENDOR_LONGHAND_PROPERTIES_HYPHEN,
    generics: vendorLonghandPropertiesGenerics,
    extends: [],
    export: true,
    properties: vendorLonghandPropertiesHyphenDefinition,
  };

  const vendorShorthandPropertiesHyphenInterface: IInterfaceProperties = {
    name: INTERFACE_VENDOR_SHORTHAND_PROPERTIES_HYPHEN,
    generics: vendorShorthandPropertiesGenerics,
    extends: [],
    export: true,
    properties: vendorShorthandPropertiesHyphenDefinition,
  };

  const vendorPropertiesHyphenInterface: IInterfaceProperties = {
    name: INTERFACE_VENDOR_PROPERTIES_HYPHEN,
    generics: vendorPropertiesGenerics,
    extends: [vendorLonghandPropertiesHyphenInterface, vendorShorthandPropertiesHyphenInterface],
    export: true,
    properties: [],
  };

  const obsoletePropertiesHyphenInterface: IInterfaceProperties = {
    name: INTERFACE_OBSOLETE_PROPERTIES_HYPHEN,
    generics: obsoletePropertiesGenerics,
    extends: [],
    export: true,
    properties: obsoletePropertiesHyphenDefinition,
  };

  const svgPropertiesHyphenInterface: IInterfaceProperties = {
    name: INTERFACE_SVG_PROPERTIES_HYPHEN,
    generics: svgPropertiesGenerics,
    extends: [],
    export: true,
    properties: svgPropertiesHyphenDefinition,
  };

  const allPropertiesHyphenInterface: IInterfaceProperties = {
    name: INTERFACE_ALL_PROPERTIES_HYPHEN,
    generics: allPropertiesGenerics,
    extends: [
      standardPropertiesHyphenInterface,
      vendorPropertiesHyphenInterface,
      obsoletePropertiesHyphenInterface,
      svgPropertiesHyphenInterface,
    ],
    export: true,
    properties: [],
  };

  const standardLongformPropertiesFallbackInterface: IInterfaceFallback = {
    name: INTERFACE_STANDARD_LONGHAND_PROPERTIES_FALLBACK,
    generics: standardLonghandPropertiesGenerics,
    export: true,
    fallbacks: standardLonghandPropertiesInterface,
  };

  const standardShorthandPropertiesFallbackInterface: IInterfaceFallback = {
    name: INTERFACE_STANDARD_SHORTHAND_PROPERTIES_FALLBACK,
    generics: standardShorthandPropertiesGenerics,
    export: true,
    fallbacks: standardShorthandPropertiesInterface,
  };

  const standardPropertiesFallbackInterface: IInterfaceProperties = {
    ...standardPropertiesInterface,
    name: INTERFACE_STANDARD_PROPERTIES_FALLBACK,
    extends: [standardLongformPropertiesFallbackInterface, standardShorthandPropertiesFallbackInterface],
    export: true,
  };

  const vendorLonghandPropertiesFallbackInterface: IInterfaceFallback = {
    name: INTERFACE_VENDOR_LONGHAND_PROPERTIES_FALLBACK,
    generics: vendorLonghandPropertiesGenerics,
    export: true,
    fallbacks: vendorLonghandPropertiesInterface,
  };

  const vendorShorthandPropertiesFallbackInterface: IInterfaceFallback = {
    name: INTERFACE_VENDOR_SHORTHAND_PROPERTIES_FALLBACK,
    generics: vendorShorthandPropertiesGenerics,
    export: true,
    fallbacks: vendorShorthandPropertiesInterface,
  };

  const vendorPropertiesFallbackInterface: IInterfaceProperties = {
    ...vendorPropertiesInterface,
    name: INTERFACE_VENDOR_PROPERTIES_FALLBACK,
    extends: [vendorLonghandPropertiesFallbackInterface, vendorShorthandPropertiesFallbackInterface],
    export: true,
  };

  const obsoletePropertiesFallbackInterface: IInterfaceFallback = {
    name: INTERFACE_OBSOLETE_PROPERTIES_FALLBACK,
    generics: obsoletePropertiesGenerics,
    export: true,
    fallbacks: obsoletePropertiesInterface,
  };

  const svgPropertiesFallbackInterface: IInterfaceFallback = {
    name: INTERFACE_SVG_PROPERTIES_FALLBACK,
    generics: svgPropertiesGenerics,
    export: true,
    fallbacks: svgPropertiesInterface,
  };

  const allPropertiesFallbackInterface: IInterfaceProperties = {
    ...allPropertiesInterface,
    name: INTERFACE_ALL_PROPERTIES_FALLBACK,
    extends: [
      standardPropertiesFallbackInterface,
      vendorPropertiesFallbackInterface,
      obsoletePropertiesFallbackInterface,
      svgPropertiesFallbackInterface,
    ],
    export: true,
  };

  const standardLongformPropertiesHyphenFallbackInterface: IInterfaceFallback = {
    name: INTERFACE_STANDARD_LONGHAND_PROPERTIES_HYPHEN_FALLBACK,
    generics: standardLonghandPropertiesGenerics,
    export: true,
    fallbacks: standardLonghandPropertiesHyphenInterface,
  };

  const standardShorthandPropertiesHyphenFallbackInterface: IInterfaceFallback = {
    name: INTERFACE_STANDARD_SHORTHAND_PROPERTIES_HYPHEN_FALLBACK,
    generics: standardShorthandPropertiesGenerics,
    export: true,
    fallbacks: standardShorthandPropertiesHyphenInterface,
  };

  const standardPropertiesHyphenFallbackInterface: IInterfaceProperties = {
    ...standardPropertiesHyphenInterface,
    name: INTERFACE_STANDARD_PROPERTIES_HYPHEN_FALLBACK,
    extends: [standardLongformPropertiesHyphenFallbackInterface, standardShorthandPropertiesHyphenFallbackInterface],
    export: true,
  };

  const vendorLonghandPropertiesHyphenFallbackInterface: IInterfaceFallback = {
    name: INTERFACE_VENDOR_LONGHAND_PROPERTIES_HYPHEN_FALLBACK,
    generics: vendorLonghandPropertiesGenerics,
    export: true,
    fallbacks: vendorLonghandPropertiesHyphenInterface,
  };

  const vendorShorthandPropertiesHyphenFallbackInterface: IInterfaceFallback = {
    name: INTERFACE_VENDOR_SHORTHAND_PROPERTIES_HYPHEN_FALLBACK,
    generics: vendorShorthandPropertiesGenerics,
    export: true,
    fallbacks: vendorShorthandPropertiesHyphenInterface,
  };

  const vendorPropertiesHyphenFallbackInterface: IInterfaceProperties = {
    ...vendorPropertiesHyphenInterface,
    name: INTERFACE_VENDOR_PROPERTIES_HYPHEN_FALLBACK,
    extends: [vendorLonghandPropertiesHyphenFallbackInterface, vendorShorthandPropertiesHyphenFallbackInterface],
    export: true,
  };

  const obsoletePropertiesHyphenFallbackInterface: IInterfaceFallback = {
    name: INTERFACE_OBSOLETE_PROPERTIES_HYPHEN_FALLBACK,
    generics: obsoletePropertiesGenerics,
    export: true,
    fallbacks: obsoletePropertiesHyphenInterface,
  };

  const svgPropertiesHyphenFallbackInterface: IInterfaceFallback = {
    name: INTERFACE_SVG_PROPERTIES_HYPHEN_FALLBACK,
    generics: svgPropertiesGenerics,
    export: true,
    fallbacks: svgPropertiesHyphenInterface,
  };

  const allPropertiesHyphenFallbackInterface: IInterfaceProperties = {
    ...allPropertiesHyphenInterface,
    name: INTERFACE_ALL_PROPERTIES_HYPHEN_FALLBACK,
    extends: [
      standardPropertiesHyphenFallbackInterface,
      vendorPropertiesHyphenFallbackInterface,
      obsoletePropertiesHyphenFallbackInterface,
      svgPropertiesHyphenFallbackInterface,
    ],
    export: true,
  };

  // Loop in alphabetical order
  for (const name of Object.keys(atRuleDefinitions).sort()) {
    const pascalName = toPascalCase(name);
    const generics = genericsOf(atRuleDefinitions[name].filter(isAliasProperty));
    const atRuleCamel: IInterfaceProperties = {
      name: pascalName,
      generics,
      extends: [],
      export: true,
      properties: atRuleDefinitions[name],
    };
    const atRuleHyphen: IInterfaceProperties = {
      name: pascalName + HYPHEN,
      generics,
      extends: [],
      export: true,
      properties: atRuleHyphenDefinitions[name],
    };
    atRuleInterfaces.push(
      atRuleCamel,
      atRuleHyphen,
      {
        name: pascalName + FALLBACK,
        generics,
        extends: [],
        fallbacks: atRuleCamel,
        export: true,
      },
      {
        name: pascalName + HYPHEN + FALLBACK,
        generics,
        extends: [],
        fallbacks: atRuleHyphen,
        export: true,
      },
    );
  }

  const interfaces = [
    standardLonghandPropertiesInterface,
    standardShorthandPropertiesInterface,
    standardPropertiesInterface,
    vendorLonghandPropertiesInterface,
    vendorShorthandPropertiesInterface,
    vendorPropertiesInterface,
    obsoletePropertiesInterface,
    svgPropertiesInterface,
    allPropertiesInterface,
    standardLonghandPropertiesHyphenInterface,
    standardShorthandPropertiesHyphenInterface,
    standardPropertiesHyphenInterface,
    vendorLonghandPropertiesHyphenInterface,
    vendorShorthandPropertiesHyphenInterface,
    vendorPropertiesHyphenInterface,
    obsoletePropertiesHyphenInterface,
    svgPropertiesHyphenInterface,
    allPropertiesHyphenInterface,
    standardLongformPropertiesFallbackInterface,
    standardShorthandPropertiesFallbackInterface,
    standardPropertiesFallbackInterface,
    vendorLonghandPropertiesFallbackInterface,
    vendorShorthandPropertiesFallbackInterface,
    vendorPropertiesFallbackInterface,
    obsoletePropertiesFallbackInterface,
    svgPropertiesFallbackInterface,
    allPropertiesFallbackInterface,
    standardLongformPropertiesHyphenFallbackInterface,
    standardShorthandPropertiesHyphenFallbackInterface,
    standardPropertiesHyphenFallbackInterface,
    vendorLonghandPropertiesHyphenFallbackInterface,
    vendorShorthandPropertiesHyphenFallbackInterface,
    vendorPropertiesHyphenFallbackInterface,
    obsoletePropertiesHyphenFallbackInterface,
    svgPropertiesHyphenFallbackInterface,
    allPropertiesHyphenFallbackInterface,
  ];

  const namespaces: INamespace[] = [propertyNamespace, atRuleNamespace, dataTypeNamespace];

  return { declarations: Array.from(globalDeclarations.values()), interfaces, namespaces };
}

export function isAliasProperty(value: PropertyType): value is IPropertyAlias {
  return 'alias' in value;
}

function sorter(a: MixedType, b: MixedType) {
  if (a.type === Type.StringLiteral && b.type === Type.StringLiteral) {
    return a.literal < b.literal ? -1 : a.literal > b.literal ? 1 : 0;
  }
  if (a.type === Type.NumericLiteral && b.type === Type.NumericLiteral) {
    return a.literal - b.literal;
  }
  return a.type - b.type;
}

function genericsOf(definitions: IPropertyAlias[]) {
  return Array.from(new Set(([] as IGenerics[]).concat(...definitions.map(definition => definition.generics))));
}

function onlyContainsString(types: MixedType[]) {
  return types.length === 1 && types[0].type === Type.String;
}

function onlyContainsNumber(types: MixedType[]) {
  return types.length === 1 && types[0].type === Type.Number;
}
