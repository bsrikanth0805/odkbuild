/**
 *  data.js - extractor extraordinaire
 *    Pulls out a properly structured, hierarchical tree
 *    of the control data of the form, and then massages
 *    it through a few steps to become XML output.
 */

var dataNS = odkmaker.namespace.load('odkmaker.data');

;(function($)
{
    // gets just the pure data for any one control
    var getDataRepresentation = function($control)
    {
        var data = {};
        _.each($control.data('odkControl-properties'), function(property)
        {
            data[property.name] = property.value;
        });
        data.type = $control.data('odkControl-type');
        return data;
    };

    // gets the pure data tree for any workspace DOM node
    var extractRecurse = function($root)
    {
        var result = [];
        $root.children('.control').each(function()
        {
            var $this = $(this);

            var data = getDataRepresentation($this);

            if (data.type == 'group')
            {
                data.children = extractRecurse($this.children('.workspaceInnerWrapper').children('.workspaceInner'));
            }
            else if (data.type == 'branch')
            {
                data.branches = [];
                $this.find('.workspaceInner').each(function()
                {
                    var branch = {};
                    branch.conditions = $(this).data('odkmaker-branchConditions');
                    branch.children = extractRecurse($(this));
                    data.branches.push(branch);
                });
            }

            result.push(data);
        });
        return result;
    };
    odkmaker.data.extract = function()
    {
        return {
            title: $('h2').text(),
            controls: extractRecurse($('.workspace'))
        };
    };
    
    // massages the output JSON into a structure representing an XForm
    var controlTypes = {
        inputText: 'input',
        inputNumeric: 'input',
        inputDate: 'input',
        inputLocation: 'input',
        inputSelectOne: 'select1',
        inputSelectMany: 'select'
    };
    var addTranslation = function(obj, itextPath, translations)
    {
        _.each(translations.children, function(translation)
        {
            translation.children.push({
                name: 'text',
                attrs: {
                    'id': itextPath
                },
                children: [
                    { name: 'value',
                      val: obj[translation.attrs.lang] }
                ]
            });
        })
    };
    var parseControl = function(control, xpath, relpath, instance, translations, model, body, relevance)
    {
        // groups are special
        if (control.type == 'group')
        {
            var instanceTag = {
                name: control.Name,
                children: []
            };
            instance.children.push(instanceTag);
            var bodyTag = {
                name: 'group',
                children: []
            };
            body.children.push(bodyTag);

            if ((control.Label !== undefined) && (control.Label !== ''))
            {
                bodyTag.children.push({
                    name: 'label',
                    attrs: {
                        'ref': "jr:itext('" + xpath + control.Name + ":label')"
                    }
                });
                addTranslation(control.Label, xpath + control.Name + ':label', translations);
            }

            _.each(control.children, function(child)
            { 
                parseControl(child, xpath + control.Name + '/', relpath + control.Name + '/',
                             instanceTag, translations, model, bodyTag, relevance);
            });
            return;
        }

        instance.children.push({
            name: control.Name
        });

        // control markup
        var bodyTag = {
            name: controlTypes[control.type],
            attrs: {
                'ref': control['Instance Destination'] || (relpath + control.Name)
            },
            children: []
        };
        body.children.push(bodyTag);

        // binding
        var binding = {
            name: 'bind',
            attrs: {
                'nodeset': control['Instance Destination'] || (xpath + control.Name)
            }
        }
        model.children.push(binding);

        // relevance string
        if (relevance === undefined)
            relevance = [];

        // constraint string
        var constraint = [];

        // deal with input type:
        if (control.type == 'inputText')
            binding.attrs.type = 'string';
        else if (control.type == 'inputNumeric')
        {
            if (control.Kind == 'Integer')
                binding.attrs.type = 'int';
            else if (control.Kind == 'Decimal')
                binding.attrs.type = 'decimal';
        }
        else if (control.type == 'inputDate')
            binding.attrs.type = 'date';
        else if (control.type == 'inputLocation')
            binding.attrs.type = 'geopoint';
        else if (control.type == 'inputMedia')
            binding.attrs.type = 'binary';

        // deal with properties:

        // label
        if ((control.Label !== undefined) && (control.Label !== ''))
        {
            bodyTag.children.push({
                name: 'label',
                attrs: {
                    'ref': "jr:itext('" + xpath + control.Name + ":label')"
                }
            });
            addTranslation(control.Label, xpath + control.Name + ':label', translations);
        }

        // hint
        if ((control.Hint !== undefined) && (control.Hint !== ''))
        {
            bodyTag.children.push({
                name: 'hint',
                attrs: {
                    'ref': "jr:itext('" + xpath + control.Name + ":hint')"
                }
            });
            addTranslation(control.Hint, xpath + control.Name + ':hint', translations);
        }

        // read only
        if (control['Read Only'] === true)
            binding.attrs.readonly = 'true()';

        // required
        if (control.Required === true)
            binding.attrs.required = 'true()';

        // text length
        if ((control.Length !== undefined) && (control.Length !== false))
            constraint.push('. &gt; ' + control.Length.min + ' and . &lt; ' + control.Length.max);

        // text length
        if ((control.Range !== undefined) && (control.Range !== false))
            constraint.push('. &gt; ' + control.Range.min + ' and . &lt; ' + control.Range.max);

        // media kind
        if (control.type == 'inputMedia')
            bodyTag.attrs.mediatype = control.Kind.toLowerCase() + '/*';

        // options
        if (control.Options !== undefined)
            _.each(control.Options, function(option, i)
            {
                var itextPath = xpath + control.Name + ':option' + i;
                addTranslation(option.text, itextPath, translations);

                bodyTag.children.push({
                    name: 'item',
                    children: [
                        {   name: 'label',
                            attrs: {
                                'ref': itextPath
                            } },
                        {   name: 'value',
                            val: option.val }
                    ]
                });
            });

        // advanced relevance
        if (control.Relevance !== '')
            relevance.push(control.Relevance);
        // advanced constraint
        if (control.Constraint !== '')
            constraint.push(control.Constraint);

        if (relevance.length > 0)
            binding.attrs.relevant = '(' + relevance.join(') and (') + ')';
        if (constraint.length > 0)
            binding.attrs.constraint = '(' + constraint.join(') and (') + ')';
    };
    var internalToXForm = function(internal)
    {
        // basic structure
        // TODO: user-config of instanceHead
        var instanceHead = {
            name: 'data',
            children: []
        };

        var instance = {
            name: 'instance',
            children: [ instanceHead ]
        };
        var translations = {
            name: 'itext',
            children: []
        };
        var model = {
            name: 'model',
            children: [ instance, translations ]
        };
        var body = {
            name: 'h:body',
            children: []
        };
        var root = {
            name: 'h:html',
            attrs: {
                'xmlns': 'http://www.w3.org/2002/xforms',
                'xmlns:h': 'http://www.w3.org/1999/xhtml',
                'xmlns:ev': 'http://www.w3.org/2001/xml-events',
                'xmlns:xsd': 'http://www.w3.org/2001/XMLSchema',
                'xmlns:jr': 'http://openrosa.org/javarosa'
            },
            children: [
                {   name: 'h:head',
                    children: [
                        {   name: 'h:title',
                            val: internal.title },
                        model
                    ] },
                body
            ]
        };

        _.each(odkmaker.i18n.activeLanguages(), function(language)
        {
            translations.children.push({
                name: 'translation',
                attrs: {
                    'lang': language
                },
                children: []
            });
        });

        _.each(internal.controls, function(control)
        {
            parseControl(control, '/data/', '', instanceHead, translations, model, body);
        });

        return root;
    };

    // XML serializer
    var generateIndent = function(indentLevel)
    {
        var result = '';
        for (var i = 0; i < indentLevel; i++)
            result += '  ';
        return result;
    };
    var JSONtoXML = function(obj, indentLevel)
    {
        if (indentLevel === undefined)
            indentLevel = 0;
        var result = generateIndent(indentLevel);

        result += '<' + obj.name;

        if (obj.attrs !== undefined)
            _.each(obj.attrs, function(value, key)
            {
                result += ' ' + key + '="' + value + '"';
            });

        if (obj.val !== undefined)
        {
            result += '>' + obj.val + '</' + obj.name + '>\n';
        }
        else if (obj.children !== undefined)
        {
            result += '>\n';
            _.each(obj.children, function(child)
            {
                result += JSONtoXML(child, indentLevel + 1);
            });
            result += generateIndent(indentLevel) + '</' + obj.name + '>\n';
        }
        else
        {
            result += '/>\n';
        }

        return result;
    };

    // Kick it off
    odkmaker.data.serialize = function()
    {
        return JSONtoXML(internalToXForm(odkmaker.data.extract()));
    };
})(jQuery);