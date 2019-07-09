/*
 * This is sample code that shows how DOM Diffs module can be used
 */

var xpath = require('xpath');
var xmldom = require("xmldom");
var parser = new xmldom.DOMParser();
var fs = require('fs');
var underscore = require('underscore');
var domDiff = require("./domDiff.js");

let sample1 = "nutrition1.xml";
let sample1Mod = "nutrition1-mod.xml";
let sample2 = "nutrition2.xml";
let sample2Mod = "nutrition2-mod.xml";

//if any of these nodes change, the node is considered a new node, not an update. The path here is relative to the node compared, in this case "food"
const foodCriticalNodeNames = ["name", "mfr"]; 

/**
 * Process two given XML strings, determine delta and identify the actions that need to be taken on the delta.
 * If currentXMLFile is null, then only the newXMLFile is processed. This will result in identifying all the nodes as new
 * @return An object of the shape: {food: {"<ACTION_TYPE>": [<dom nodes in here>], "<ACTION_TYPE>": [<dom nodes in here>], ...}}
 */
function xmlStringActions(currentXMLText, newXMLText)
{
	let allActions = {};

	let existingDOM = null;
	let modifiedDOM = null;
	let existFood = null;
	let modFood = null;

	if(!underscore.isEmpty(currentXMLText))
	{
		existingDOM = parser.parseFromString(domDiff.removeWhitespaceAroundTags(currentXMLText), "text/xml");
	}

	modifiedDOM = parser.parseFromString(domDiff.removeWhitespaceAroundTags(newXMLText), "text/xml");
	modFood = xpath.select("//nutrition/food", modifiedDOM);

	let foodNodesAction = null;

	if(existingDOM)
	{//only if there is an existing DOM we can do this comparison, otherwise, there is nothing to compare
		existFood = xpath.select("//nutrition/food", existingDOM);

		let foodComparison = domDiff.compareNodes(existFood, modFood, []);
		foodNodesAction = domDiff.determineNodesAction(foodComparison.uniqueExistNodes , foodComparison.uniqueModNodes, [], foodCriticalNodeNames)
	}
	else
	{ //there is no xml file to compare to, only the new file needs to be processed
		if(!underscore.isEmpty(modDegrees))
		{
			foodNodesAction = {};
			foodNodesAction[domDiff.ACTION_TYPE.CREATE] = [];
			for(let i = 0; i < modFood.length; i++)
			{
				foodNodesAction[domDiff.CREATE].push(modFood[i]);
			}
		}
	}

	if(!underscore.isEmpty(foodNodesAction))
	{
		allActions["food"] = foodNodesAction;
	}

	return allActions;
}

/**
 * Process two given XML files, determine delta and identify the actions that need to be taken on the delta.
 * If currentXMLFile is null, then only the newXMLFile is processed. This will result in identifying all the nodes as new
 * Reads the file contents then call xmlStringActions to process the actual XML
 * @return see xmlStringActions
 */
function xmlFileActions(currentXMLFile, newXMLFile)
{
	let currentXMLFileText = "";

	if(!underscore.isEmpty(currentXMLFile))
	{
		currentXMLFileText = fs.readFileSync(currentXMLFile, "utf8");
	}

	let newXMLFileText = fs.readFileSync(newXMLFile, "utf8");

	return xmlStringActions(currentXMLFileText, newXMLFileText);
}

//Let's see the results. The file only has a change to one food item mfr field, however, mfr field is a critical field.
//The correct output would idicate that the old food item should be deleted and relaced by the new one (not just an update)
let actions = xmlFileActions(sample2, sample2Mod);
console.log("Actions", actions);
var canonizingSerializer = new (require('dom-compare').XMLSerializer)();
console.log("ADD THIS new one:", canonizingSerializer.serializeToString(actions.food.create[0]))
console.log("DELETE THIS old one:", canonizingSerializer.serializeToString(actions.food.delete[0]))
