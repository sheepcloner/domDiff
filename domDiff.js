/*
Comparing the DOMs of two xml files and identifying the difference
*/

var underscore = require('underscore');
var xpath = require('xpath');
var xmldom = require("xmldom");
var compare = require('dom-compare').compare,
    canonizingSerializer = new (require('dom-compare').XMLSerializer)();

var bunyan = require('bunyan');

const log = bunyan.createLogger({
  name: 'xml_dom_diff',
  level: bunyan.DEBUG
});

const ACTION_TYPE = Object.freeze({
    CREATE: "create",
    UPDATE: "update",
    DELETE: "delete"
});

/**
 * cleans up unneeded spaces surrounding XML elements (as in before and after xml element tags)
 */
function removeWhitespaceAroundTags(data)
{
	data = data.replace(/>\s*/g, '>');  // Remove space after >
	data = data.replace(/\s*</g, '<');  // Remove space before <

	return data;
}

function printXMLNodes(xmlNodes)
{
	for(let i = 0; i < xmlNodes.length; i++)
	{
		log.info(canonizingSerializer.serializeToString(xmlNodes[i]));
	}
}

/**
 * Compares two XML DOM nodes and returns the delta between them
 * relatedXpathsToCompare - In some cases there are other XML elements that are not within the node but are related to it. This list represents relative paths for the each node in existNodes, modNodes
 * @returns uniqueExistNodes - Nodes from existNodes that were not found in modNodes
 *			uniqueModNodes - Nodes from modNodes that were not found in existNodes
 *			differenceCount - summative count of number of nodes in uniqueExistNodes and uniqueModNodes
 */
function compareNodes(existNodes, modNodes, relatedXpathsToCompare)
{
	for(let i = existNodes.length-1; i >= 0; i--) //starting from the end of the list because code below will remove entries from array
	{
		for(let j = modNodes.length-1; j >= 0; j--)
		{
			//log.debug(message: `Examining existNodes ${i} and modNodes ${j}. existNodes.length is ${existNodes.length} and modNodes.length is ${modNodes.length}`);
			let mainResult = compare(existNodes[i], modNodes[j]);
			let isSame = mainResult.getResult();

			if(relatedXpathsToCompare && relatedXpathsToCompare.length > 0)
			{ //Check all related paths if they exist
				for(let k = 0; k < relatedXpathsToCompare.length; k++)
				{
					let nodeDiff = compare(xpath.select1(relatedXpathsToCompare[k], existNodes[i]), xpath.select1(relatedXpathsToCompare[k], modNodes[j]));
					isSame = isSame && nodeDiff.getResult(); //ANDing the results will cause a single not equal element to set the whole thing to false
				}
			}
			//if(mainResult.getResult())
			if(isSame)
			{ //they were the same
				existNodes.splice(i, 1); //delete this entry since it has a match
				modNodes.splice(j, 1);
				break; // no need to continue in the loop
			}
		}
	}
	return {"uniqueExistNodes": existNodes, "uniqueModNodes": modNodes, "differenceCount": (existNodes.length + modNodes.length)};
}

/**
 * Calculates the difference between two given XML DOM nodes
  * criticalNodeNames - A string array containing node element names that are critical to the comparison. If there is a difference containing ANY of them, then it is the nodes are considered different regardless of other element similarity
 * @return diffCount - Number of different child nodes between the compared nodes
 *		   diffDegree - Value between 0 & 1 representing the percentage of difference between the compared nodes. Smaller values means more similar
 *		   diffIsInCriticalNodes - Whether the difference in the two nodes is found in the criticalNodeNames or not
 */
function calcNodeDifference(existNode, modNode, criticalNodeNames)
{

	let diffIsInCriticalNodes = false; //indicator as to whether the difference found is in the critical nodes or not
	let diff = compare(existNode, modNode).getDifferences(); //Compare the two nodes and get the difference
	let diffNodeNames = underscore.pluck(diff, "node"); //fetch all the "node" properties from "diff" array

	//determine if any of the critical node names is in the list of differences
	for(let i = 0; i < criticalNodeNames.length && diffIsInCriticalNodes == false; i++)
	{
		for(let j = 0; j < diffNodeNames.length && diffIsInCriticalNodes == false; j++)
		{
			if(diffNodeNames[j].endsWith(criticalNodeNames[i]))
			{ //One of the critical node names was found in the list of outlined differences
				diffIsInCriticalNodes = true;
			}
		}
	}

	//degree of diff needs to be normalized between 0 & 1. diff.length contains the diff count and is multiplied by 2 since the we are comparing 2 nodes
	//denominator includes the total number of child nodes that each of the nodes being compared have
	let diffDegree = (diff.length*2)/(existNode.childNodes.length + modNode.childNodes.length);
	log.debug({message: `existNode is ${diff.length} different from modNode. nodes have ${diffDegree} degree of difference, diffIsInCriticalNodes? ${diffIsInCriticalNodes}. Result: ${JSON.stringify(diff, null, 2)}`});
	return {"diffCount": diff.length, "diffDegree": diffDegree, "diffIsInCriticalNodes": diffIsInCriticalNodes};
}

/**
 * Uses calcNodeDifference.
 * The difference here is that relatedXpathsToCompare is given which represents other XML elements that are not within the node but are related to it.
 * This list represents relative paths for the existNode and modNode nodes.
 * Results across all the comparisons are aggregated and returned. If any of the comparisons identifies difference in node name captured in criticalNodeNames, the diffIsInCriticalNodes will be set to true
 */
function calcNodeAggregateDifference(existNode, modNode, relatedXpathsToCompare, criticalNodeNames)
{
	log.debug({message: `Calculating node aggregate difference`});
	let aggregateDiff = calcNodeDifference(existNode, modNode, criticalNodeNames); //the difference between the actual nodes, not including related nodes

	if(relatedXpathsToCompare && relatedXpathsToCompare.length > 0)
	{
		for(let i = 0; i < relatedXpathsToCompare.length; i++)
		{
			let nodeDiff = calcNodeDifference(xpath.select(relatedXpathsToCompare[i], existNode)[0], xpath.select(relatedXpathsToCompare[i], modNode)[0], criticalNodeNames)
			aggregateDiff.diffCount += nodeDiff.diffCount;
			aggregateDiff.diffDegree = (aggregateDiff.diffDegree + nodeDiff.diffDegree)/2.0; //average out the difference
			aggregateDiff.diffIsInCriticalNodes = aggregateDiff.diffIsInCriticalNodes || nodeDiff.diffIsInCriticalNodes; //if any of the values is true, diffIsInCriticalNodes needs to be false hence why OR is used
		}
	}

	return aggregateDiff;
}

/**
 * Given existing nodes list and modified node list, the function will attempt to correlate nodes across the lists to determine an action to be taken against each. Actions are 
 * CREATE, UPDATE or DELETE.
 * relatedXpathsToCompare - In some cases there are other XML elements that are not within the node but are related to it. This list represents relative paths for the each node in existNodeList, modNodeList
 * criticalNodeNames - A string array containing node element names that are critical to the comparison. If there is a difference containing ANY of them, then it is the nodes are considered different regardless of other element similarity
 * Actions:
 * If nodes have the same criticalNodeNames, then the action will be UPDATE
 * If nodes are in the modNodeList do not have overlap in criticalNodeNames nodes, then CREATE
 * If nodes in the existNodeList remain after the two above elimination steps, then they are considered existing nodes that no longer are in the new list and therefore DELETE
 * @return  Object containing create nodes, update nodes and delete nodes. Each list reflects the action that needs to be conducted on said nodes
 */
function determineNodesAction(existNodeList, modNodeList, relatedXpathsToCompare, criticalNodeNames)
{
	let createNodes = [];
	let updateNodes = [];
	let deleteNodes = [];

	for(let i = modNodeList.length-1; i >= 0; i--) //starting from the end of the list because code below will remove entries from array
	{
		let modNodeCommitedToAction = false;

		for(let j = existNodeList.length-1; j >= 0; j--)
		{
			log.debug({message: `existNodes index ${j}/${existNodeList.length}, modNodes index ${i}/${modNodeList.length}`});
			let diffDegree = calcNodeAggregateDifference(existNodeList[j], modNodeList[i], relatedXpathsToCompare, criticalNodeNames);
			//let diffDegree = calcNodeDifference(existNodeList[j], modNodeList[i], criticalNodeNames);
			if(diffDegree.diffIsInCriticalNodes == false)
			{ //there is a difference, but it is not in the critical fields, this is an update case
				updateNodes.push(modNodeList[i]); //this is the modified node that needs to be used
				existNodeList.splice(j, 1); //delete this entry since it has a match
				modNodeList.splice(i, 1);
				log.debug({message: `U - Flagged node for UPDATE action`});
				modNodeCommitedToAction = true;
				break; //the object from the outerloop has already been commited to an action, no need to continue in inner loop
			}
		}
		if(modNodeCommitedToAction == false)
		{ //there was not a node similar to this one in the existing nodes list, therefore it must be a new node
			createNodes.push(modNodeList[i]);

			modNodeList.splice(i, 1);
			log.debug({message: `C - Flagged node for CREATE action`});
		}
	}

	//at this point the modNodeList should be empty, but the existNodeList could have some items left, which will become delete candidates
	if(modNodeList.length > 0)
	{
		log.error({message: `DANGER: The modified node list still has nodes left in it. This should not happen and there is a logic error in the application. modNodeList content: ${JSON.stringify(modNodeList)}`});
	}

	if(existNodeList.length > 0)
	{
		for(let i = 0; i < existNodeList.length; i++)
		{
			deleteNodes.push(existNodeList[i]);
		}
		log.debug({message: `R - Flagged ${deleteNodes.length} node(s) for DELETE action`});
	}
	log.info({message: `Action Summary: ${createNodes.length} flagged for CREATE, ${updateNodes.length} flagged for UPDATE, ${deleteNodes.length} flagged for DELETE`});

	let nodeActions = {};
	if(!underscore.isEmpty(createNodes))
	{
		nodeActions[ACTION_TYPE.CREATE] = createNodes;
	}

	if(!underscore.isEmpty(updateNodes))
	{
		nodeActions[ACTION_TYPE.UPDATE] = updateNodes;
	}

	if(!underscore.isEmpty(deleteNodes))
	{
		nodeActions[ACTION_TYPE.DELETE] = deleteNodes;
	}

	return nodeActions;
}

module.exports = {
	removeWhitespaceAroundTags,
	printXMLNodes,
	compareNodes,
	calcNodeDifference,
	calcNodeAggregateDifference,
	determineNodesAction,
	ACTION_TYPE
};