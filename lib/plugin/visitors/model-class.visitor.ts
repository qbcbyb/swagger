import {
  ApiHideProperty,
  ApiProperty,
  ApiPropertyOptional
} from '@nestjs/swagger';
import { METADATA_FACTORY_NAME } from '@nestjs/swagger/dist/plugin/plugin-constants';
import { getDecoratorArguments } from '@nestjs/swagger/dist/plugin/utils/ast-utils';
import {
  getDecoratorOrUndefinedByNames,
  hasPropertyKey
} from '@nestjs/swagger/dist/plugin/utils/plugin-utils';
import { compact, flatten, head } from 'lodash';
import * as ts from 'typescript';
import { PluginOptions } from '../merge-options';
import { getMainCommentAnExamplesOfNode } from '../utils/ast-utils';
import { AbstractFileVisitor } from './abstract.visitor';

const metadataHostMap = new Map();

export class ModelClassVisitor extends AbstractFileVisitor {
  visit(
    sourceFile: ts.SourceFile,
    ctx: ts.TransformationContext,
    program: ts.Program,
    options: PluginOptions
  ) {
    const typeChecker = program.getTypeChecker();

    const visitNode = (node: ts.Node): ts.Node => {
      if (!this.hasOpenApiDeclared && ts.isImportEqualsDeclaration(node)) {
        if (this.checkIsOpenApiImport(node)) {
          this.updateImports(sourceFile);
        }
      }
      if (ts.isClassDeclaration(node)) {
        node = ts.visitEachChild(node, visitNode, ctx);
        return this.addMetadataFactory(node as ts.ClassDeclaration);
      } else if (ts.isPropertyDeclaration(node)) {
        const decorators = node.decorators;
        const hidePropertyDecorator = getDecoratorOrUndefinedByNames(
          [ApiHideProperty.name],
          decorators
        );
        if (hidePropertyDecorator) {
          return node;
        }

        let apiOperationOptionsProperties: ts.NodeArray<ts.PropertyAssignment>;
        const apiPropertyDecorator = getDecoratorOrUndefinedByNames(
          [ApiProperty.name, ApiPropertyOptional.name],
          decorators
        );
        if (apiPropertyDecorator) {
          apiOperationOptionsProperties = head(
            getDecoratorArguments(apiPropertyDecorator)
          )?.properties;
          node.decorators = ts.createNodeArray([
            ...node.decorators.filter(
              decorator => decorator != apiPropertyDecorator
            )
          ]);
        }

        const isPropertyStatic = (node.modifiers || []).some(
          modifier => modifier.kind === ts.SyntaxKind.StaticKeyword
        );
        if (isPropertyStatic) {
          return node;
        }
        try {
          this.inspectPropertyDeclaration(
            node,
            typeChecker,
            options,
            apiOperationOptionsProperties ?? ts.createNodeArray(),
            sourceFile.fileName,
            sourceFile
          );
        } catch (err) {}
        return node;
      }
      return ts.visitEachChild(node, visitNode, ctx);
    };
    return ts.visitNode(sourceFile, visitNode);
  }

  addMetadataFactory(node: ts.ClassDeclaration) {
    const classMetadata = this.getClassMetadata(node as ts.ClassDeclaration);
    if (!classMetadata) {
      return node;
    }
    const classMutableNode = ts.getMutableClone(node);

    const metadataFactoryMethod = classMutableNode.members.find(
      member =>
        ts.isMethodDeclaration(member) &&
        member.modifiers.some(
          modifier => modifier.kind === ts.SyntaxKind.StaticKeyword
        ) &&
        (member.name as ts.Identifier).text === METADATA_FACTORY_NAME
    ) as ts.MethodDeclaration;
    if (metadataFactoryMethod) {
      let returnStatement: ts.ReturnStatement;
      metadataFactoryMethod.body.forEachChild(
        child => (returnStatement = child as ts.ReturnStatement)
      );
      const classMetadataKeys = Object.keys(classMetadata);
      if (ts.isObjectLiteralExpression(returnStatement.expression)) {
        const properties = returnStatement.expression.properties;
        properties.map(value => {
          const name = value.name;
          if (
            ts.isPropertyAssignment(value) &&
            ts.isIdentifier(name) &&
            classMetadataKeys.some(k => k === name.text)
          ) {
            const propertyValue = value.initializer;
            if (ts.isObjectLiteralExpression(propertyValue)) {
              const existingProperties = propertyValue.properties;

              const newProperties = (classMetadata[
                name.text
              ] as ts.ObjectLiteralExpression).properties.filter(
                p =>
                  !existingProperties.some(
                    existingProperty =>
                      (existingProperty.name as any).text ===
                      (p.name as any).text
                  )
              );
              const objectLiteralProperties = [
                ...existingProperties,
                ...newProperties
              ];
              value.initializer = ts.createObjectLiteral(
                objectLiteralProperties
              );
            }
          }
        });
      }
    } else {
      const returnValue = ts.createObjectLiteral(
        Object.keys(classMetadata).map(key =>
          ts.createPropertyAssignment(
            ts.createIdentifier(key),
            classMetadata[key]
          )
        )
      );
      const method = ts.createMethod(
        undefined,
        [ts.createModifier(ts.SyntaxKind.StaticKeyword)],
        undefined,
        ts.createIdentifier(METADATA_FACTORY_NAME),
        undefined,
        undefined,
        [],
        undefined,
        ts.createBlock([ts.createReturn(returnValue)], true)
      );
      (classMutableNode as ts.ClassDeclaration).members = ts.createNodeArray([
        ...(classMutableNode as ts.ClassDeclaration).members,
        method
      ]);
    }
    return classMutableNode;
  }

  inspectPropertyDeclaration(
    compilerNode: ts.PropertyDeclaration,
    typeChecker: ts.TypeChecker,
    options: PluginOptions,
    existingProperties: ts.NodeArray<ts.PropertyAssignment>,
    hostFilename: string,
    sourceFile: ts.SourceFile
  ) {
    const objectLiteralExpr = this.createDecoratorObjectLiteralExpr(
      compilerNode,
      typeChecker,
      existingProperties,
      options,
      hostFilename,
      sourceFile
    );
    this.addClassMetadata(compilerNode, objectLiteralExpr, sourceFile);
  }

  createDecoratorObjectLiteralExpr(
    node: ts.PropertyDeclaration | ts.PropertySignature,
    typeChecker: ts.TypeChecker,
    existingProperties: ts.NodeArray<
      ts.PropertyAssignment
    > = ts.createNodeArray(),
    options: PluginOptions = {},
    hostFilename = '',
    sourceFile?: ts.SourceFile
  ): ts.ObjectLiteralExpression {
    const descriptionPropertyWapper = [];
    const examplesPropertyWapper = [];
    if (sourceFile) {
      const [comments, examples] = getMainCommentAnExamplesOfNode(
        node,
        sourceFile,
        true
      );
      if (!hasPropertyKey('description', existingProperties) && comments) {
        descriptionPropertyWapper.push(
          ts.createPropertyAssignment('description', ts.createLiteral(comments))
        );
      }
      if (
        !(
          hasPropertyKey('example', existingProperties) ||
          hasPropertyKey('examples', existingProperties)
        ) &&
        examples.length
      ) {
        if (examples.length == 1) {
          examplesPropertyWapper.push(
            ts.createPropertyAssignment(
              'example',
              ts.createLiteral(examples[0])
            )
          );
        } else {
          examplesPropertyWapper.push(
            ts.createPropertyAssignment(
              'examples',
              ts.createArrayLiteral(examples.map(e => ts.createLiteral(e)))
            )
          );
        }
      }
    }
    const properties = [
      ...existingProperties,
      ...descriptionPropertyWapper,
      ...examplesPropertyWapper
    ];
    const objectLiteral = ts.createObjectLiteral(compact(flatten(properties)));
    return objectLiteral;
  }

  addClassMetadata(
    node: ts.PropertyDeclaration,
    objectLiteral: ts.ObjectLiteralExpression,
    sourceFile: ts.SourceFile
  ) {
    const hostClass = node.parent;
    const className = hostClass.name && hostClass.name.getText();
    if (!className) {
      return;
    }
    const existingMetadata = metadataHostMap.get(className) || {};
    const propertyName = node.name && node.name.getText(sourceFile);
    if (
      !propertyName ||
      (node.name && node.name.kind === ts.SyntaxKind.ComputedPropertyName)
    ) {
      return;
    }
    if (objectLiteral.properties.length === 0) {
      return;
    }
    metadataHostMap.set(className, {
      ...existingMetadata,
      [propertyName]: objectLiteral
    });
  }

  getClassMetadata(node: ts.ClassDeclaration) {
    if (!node.name) {
      return;
    }
    return metadataHostMap.get(node.name.getText());
  }
}
